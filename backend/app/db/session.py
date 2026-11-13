from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    # Compatible con el "Transaction pooler" de Supabase (no usa prepared statements)
    connect_args={"prepare_threshold": None},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Session, "after_begin")
def _set_audit_context(session: Session, _transaction, connection) -> None:
    """Indica a PostgreSQL quién ejecuta la acción, para que la bitácora
    (trigger `log_activity`) registre el actor correcto. Es local a la transacción."""
    user_id = session.info.get("user_id")
    if user_id:
        connection.execute(text("select set_config('app.user_id', :uid, true)"), {"uid": user_id})
        connection.execute(text("select set_config('app.source', 'api', true)"))


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
