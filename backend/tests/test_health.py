from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"


def test_request_id_header_on_health():
    client = TestClient(app)
    r = client.get("/health")
    assert r.headers.get("X-Request-Id")


def test_openapi_contract():
    client = TestClient(app)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    data = r.json()
    assert "paths" in data
    assert "/health" in data["paths"]
