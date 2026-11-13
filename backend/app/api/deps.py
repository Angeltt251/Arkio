from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import AuthError, AuthUser, decode_access_token
from app.db.models import Profile
from app.db.session import SessionLocal

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> AuthUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de acceso")
    try:
        return decode_access_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc


def get_user_db(user: Annotated[AuthUser, Depends(get_current_user)]) -> Iterator[Session]:
    """Sesión de BD "a nombre" del usuario: todo lo que escriba queda en la bitácora con su id."""
    with SessionLocal() as db:
        db.info["user_id"] = str(user.id)
        if db.get(Profile, user.id) is None:
            # Respaldo por si el trigger de Supabase aún no creó el perfil
            db.add(Profile(id=user.id, email=user.email or "", full_name=user.full_name or (user.email or "").split("@")[0]))
            db.commit()
        yield db


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
UserDB = Annotated[Session, Depends(get_user_db)]
