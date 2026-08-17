"""ORM-модели: доменные модули re-export из legacy-реестра (постепенный перенос)."""

from app.models._legacy import *  # noqa: F403
from app.models.finance_osv import *  # noqa: F403
from app.models.waiting_callback import *  # noqa: F403
