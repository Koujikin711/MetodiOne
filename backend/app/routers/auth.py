from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.security import create_access_token, hash_password, jwt_claims_for_user, verify_password
from app.database import get_db
from app.models import Company, User, UserRole
from app.schemas.token import Token
from app.schemas.user import ChangePasswordBody, UserCreate, UserLogin, UserMeRead, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if body.role in (UserRole.super_owner, UserRole.owner, UserRole.admin, UserRole.finance_analyst, UserRole.accountant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Высокие роли выдаются только приглашением",
        )
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if body.phone:
        phone_digits = "".join(ch for ch in body.phone if ch.isdigit())
        if phone_digits:
            existing_phone = await db.execute(select(User).where(User.phone == phone_digits))
            if existing_phone.scalar_one_or_none() is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone already registered")
    company_id = (await db.execute(select(Company.id).order_by(Company.id.asc()).limit(1))).scalar_one_or_none()
    if company_id is None:
        comp = Company(name="Default Company", is_active=True)
        db.add(comp)
        await db.flush()
        company_id = comp.id
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        company_id=company_id,
        phone=("".join(ch for ch in (body.phone or "") if ch.isdigit()) or None),
        full_name=(body.full_name or "").strip() or None,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


SANDBOX_COMPANY_NAME = "Public Sandbox (MetodiOne Studio)"
SANDBOX_EMAIL = "demo@sandbox.local"


@router.post("/demo-login", response_model=Token)
async def demo_login(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Token:
    """Passwordless studio entry into an isolated sandbox company (not client tenants)."""
    company = (
        await db.execute(select(Company).where(Company.name == SANDBOX_COMPANY_NAME).limit(1))
    ).scalars().first()
    if company is None:
        company = Company(name=SANDBOX_COMPANY_NAME, is_active=True)
        db.add(company)
        await db.flush()
    user = (
        await db.execute(select(User).where(User.email == SANDBOX_EMAIL).limit(1))
    ).scalars().first()
    if user is None:
        user = User(
            email=SANDBOX_EMAIL,
            hashed_password=hash_password("sandbox-not-used"),
            role=UserRole.owner,
            company_id=int(company.id),
            full_name="Studio Demo",
            must_change_password=False,
            is_active=True,
        )
        db.add(user)
        await db.flush()
    else:
        user.company_id = int(company.id)
        user.is_active = True
        user.must_change_password = False
    await db.flush()
    await db.refresh(user)

    # Fill the sandbox with a year of believable CRM history on first entry.
    # A savepoint keeps the company/user even if the (best-effort) seeding fails.
    try:
        from app.services.demo_seed import seed_sandbox_demo_data

        async with db.begin_nested():
            await seed_sandbox_demo_data(db, int(company.id), int(user.id))
    except Exception:  # noqa: BLE001 — demo entry must succeed even if seeding fails
        pass

    extra = jwt_claims_for_user(user)
    extra["sandbox"] = True
    token = create_access_token(str(user.id), extra=extra)
    return Token(access_token=token, must_change_password=False)


@router.post("/login", response_model=Token)
async def login(
    body: UserLogin,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Token:
    identifier = body.email
    if "@" in identifier:
        result = await db.execute(select(User).where(User.email == identifier))
    else:
        result = await db.execute(select(User).where(User.phone == identifier))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect login or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт отключён")
    if user.role == UserRole.super_owner:
        if "@" not in identifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Для супер-владельца вход только по email",
            )
    if user.company_id is not None:
        company = await db.get(Company, int(user.company_id))
        if company is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
        if not company.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Компания временно приостановлена")
    extra = jwt_claims_for_user(user)
    token = create_access_token(str(user.id), extra=extra)
    return Token(
        access_token=token,
        must_change_password=bool(getattr(user, "must_change_password", False)),
    )


@router.get("/me", response_model=UserMeRead)
async def me(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserMeRead:
    from app.services.chief_expert_access import is_chief_expert

    payload = getattr(current_user, "_jwt_payload", {}) or {}
    imp = payload.get("impersonated_by")
    imp_id = int(imp) if imp is not None and str(imp).isdigit() else None
    chief = await is_chief_expert(db, current_user)
    return UserMeRead(
        id=current_user.id,
        email=current_user.email,
        role=current_user.role,
        company_id=current_user.company_id,
        phone=current_user.phone,
        full_name=current_user.full_name,
        must_change_password=bool(getattr(current_user, "must_change_password", False)),
        impersonated_by_user_id=imp_id,
        is_chief_expert=chief,
    )


@router.post("/change-password", response_model=Token)
async def change_password(
    body: ChangePasswordBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Token:
    if not verify_password(body.old_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный текущий пароль")
    current_user.hashed_password = hash_password(body.new_password)
    current_user.must_change_password = False
    await db.flush()
    extra = jwt_claims_for_user(current_user)
    token = create_access_token(str(current_user.id), extra=extra)
    return Token(access_token=token, must_change_password=False)
