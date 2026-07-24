from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import crud
from database import get_db
from models import PHASE_ONE_MODULES, get_column_metadata, get_primary_key_column, get_table
from schemas import RecordPayload

router = APIRouter(prefix="/api", tags=["Phase 1 Master Data"])


def ensure_module(module_key: str):
    if module_key not in PHASE_ONE_MODULES:
        raise HTTPException(status_code=404, detail="Module not found.")


@router.get("/modules")
def get_modules():
    return [
        {
            "key": key,
            "title": module["title"],
            "table": module["table"],
            "route": module["route"],
            "columns": get_column_metadata(key),
        }
        for key, module in PHASE_ONE_MODULES.items()
    ]


@router.get("/dashboard")
def dashboard_counts(db: Session = Depends(get_db)):
    return {
        "departments": crud.count_records(db, "departments"),
        "employees": crud.count_records(db, "employees"),
        "vendors": crud.count_records(db, "vendors"),
        "items": crud.count_records(db, "items"),
        "customers": crud.count_records(db, "customers"),
    }


@router.get("/{module_key}/lookup")
def lookup_records(module_key: str, db: Session = Depends(get_db)):
    ensure_module(module_key)
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    rows = crud.list_records(db, module_key)
    options = []
    for row in rows:
        label_parts = [
            str(value)
            for key, value in row.items()
            if key != primary_key.name and value not in (None, "")
        ][:3]
        options.append(
            {
                "value": row[primary_key.name],
                "label": " - ".join(label_parts) or str(row[primary_key.name]),
            }
        )
    return options


@router.get("/{module_key}")
def list_records(module_key: str, db: Session = Depends(get_db)):
    ensure_module(module_key)
    return crud.list_records(db, module_key)


@router.get("/{module_key}/{record_id}")
def get_record(module_key: str, record_id: str, db: Session = Depends(get_db)):
    ensure_module(module_key)
    record = crud.get_record(db, module_key, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return record


@router.post("/{module_key}", status_code=201)
def create_record(
    module_key: str,
    payload: RecordPayload,
    db: Session = Depends(get_db),
):
    ensure_module(module_key)
    try:
        return crud.create_record(db, module_key, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{module_key}/{record_id}")
def update_record(
    module_key: str,
    record_id: str,
    payload: RecordPayload,
    db: Session = Depends(get_db),
):
    ensure_module(module_key)
    try:
        record = crud.update_record(db, module_key, record_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return record


@router.delete("/{module_key}/{record_id}")
def delete_record(module_key: str, record_id: str, db: Session = Depends(get_db)):
    ensure_module(module_key)
    try:
        deleted = crud.delete_record(db, module_key, record_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found.")
    return {"message": "Record deleted successfully."}
