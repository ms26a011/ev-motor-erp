from typing import Any

from pydantic import BaseModel, ConfigDict


class RecordPayload(BaseModel):
    model_config = ConfigDict(extra="allow")


class MessageResponse(BaseModel):
    message: str
    data: dict[str, Any] | None = None
