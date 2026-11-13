"""Validación de los tokens de Supabase Auth.

El frontend inicia sesión con Supabase y envía el `access_token` en el header
`Authorization: Bearer <token>`. Aquí se verifica la firma:

* Proyectos nuevos de Supabase firman con claves asimétricas (ES256/RS256) → se
  validan con las claves públicas del endpoint JWKS.
* Proyectos con "Legacy JWT secret" firman con HS256 → se usa SUPABASE_JWT_SECRET.
"""

from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from jwt import PyJWKClient

from app.core.config import settings

ASYMMETRIC_ALGORITHMS = {"ES256", "RS256"}


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class AuthUser:
    id: UUID
    email: str | None
    full_name: str | None = None


@lru_cache
def _jwks_client() -> PyJWKClient:
    if not settings.supabase_url:
        raise AuthError("SUPABASE_URL no está configurado")
    return PyJWKClient(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def decode_access_token(token: str) -> AuthUser:
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
        if algorithm == "HS256":
            if not settings.supabase_jwt_secret:
                raise AuthError("Token HS256 recibido pero SUPABASE_JWT_SECRET no está configurado")
            key = settings.supabase_jwt_secret
        elif algorithm in ASYMMETRIC_ALGORITHMS:
            key = _jwks_client().get_signing_key_from_jwt(token).key
        else:
            raise AuthError("Algoritmo de firma no permitido")

        claims = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience=settings.supabase_jwt_audience,
            options={"require": ["exp", "sub"]},
        )
    except AuthError:
        raise
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("La sesión expiró") from exc
    except jwt.PyJWTError as exc:
        raise AuthError("Token inválido") from exc

    metadata = claims.get("user_metadata") or {}
    return AuthUser(id=UUID(claims["sub"]), email=claims.get("email"), full_name=metadata.get("full_name"))
