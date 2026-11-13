from fastapi import APIRouter

from app.api.deps import CurrentUser, UserDB
from app.db.models import Profile
from app.schemas.dashboard import DashboardOut
from app.schemas.workspace import ProfileOut, ProfileUpdate
from app.services.dashboard import build_dashboard

router = APIRouter(tags=["perfil y dashboard"])


@router.get("/me", response_model=ProfileOut)
def get_me(user: CurrentUser, db: UserDB) -> Profile:
    return db.get(Profile, user.id)


@router.patch("/me", response_model=ProfileOut)
def update_me(payload: ProfileUpdate, user: CurrentUser, db: UserDB) -> Profile:
    profile = db.get(Profile, user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    db.commit()
    return profile


@router.get("/dashboard", response_model=DashboardOut)
def get_dashboard(user: CurrentUser, db: UserDB) -> DashboardOut:
    return build_dashboard(db, user.id)
