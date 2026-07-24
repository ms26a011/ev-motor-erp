from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from models import get_column_metadata, get_primary_key_column, get_table, is_auto_primary_key


def row_to_dict(row):
    return dict(row._mapping)


def clean_payload(module_key, payload, *, include_primary_key=False):
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    allowed_columns = {column.name: column for column in table.columns}
    cleaned = {}

    for key, value in payload.items():
        if key not in allowed_columns:
            continue
        if key == primary_key.name and not include_primary_key:
            continue
        if value == "":
            value = None
        cleaned[key] = value

    return cleaned


def validate_required_fields(module_key, payload):
    missing = []
    for column in get_column_metadata(module_key):
        if column["required"] and payload.get(column["name"]) in (None, ""):
            missing.append(column["name"])
    if missing:
        raise ValueError(f"Required field(s) missing: {', '.join(missing)}")


def list_records(db: Session, module_key: str):
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    statement = select(table).order_by(primary_key.desc())
    return [row_to_dict(row) for row in db.execute(statement).all()]


def get_record(db: Session, module_key: str, record_id):
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    statement = select(table).where(primary_key == record_id)
    row = db.execute(statement).first()
    return row_to_dict(row) if row else None


def create_record(db: Session, module_key: str, payload):
    validate_required_fields(module_key, payload)
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    cleaned = clean_payload(
        module_key,
        payload,
        include_primary_key=not is_auto_primary_key(primary_key),
    )
    try:
        result = db.execute(insert(table).values(**cleaned))
        db.commit()
        inserted_id = result.inserted_primary_key[0] if result.inserted_primary_key else None
        return get_record(db, module_key, inserted_id) if inserted_id is not None else cleaned
    except IntegrityError as exc:
        db.rollback()
        raise ValueError(str(exc.orig)) from exc
    except SQLAlchemyError:
        db.rollback()
        raise


def update_record(db: Session, module_key: str, record_id, payload):
    validate_required_fields(module_key, payload)
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    cleaned = clean_payload(module_key, payload)
    if not cleaned:
        raise ValueError("No valid fields were supplied.")

    try:
        result = db.execute(
            update(table).where(primary_key == record_id).values(**cleaned)
        )
        db.commit()
        if result.rowcount == 0:
            return None
        return get_record(db, module_key, record_id)
    except IntegrityError as exc:
        db.rollback()
        raise ValueError(str(exc.orig)) from exc
    except SQLAlchemyError:
        db.rollback()
        raise


def delete_record(db: Session, module_key: str, record_id):
    table = get_table(module_key)
    primary_key = get_primary_key_column(table)
    try:
        result = db.execute(delete(table).where(primary_key == record_id))
        db.commit()
        return result.rowcount > 0
    except IntegrityError as exc:
        db.rollback()
        raise ValueError(str(exc.orig)) from exc
    except SQLAlchemyError:
        db.rollback()
        raise


def count_records(db: Session, module_key: str):
    table = get_table(module_key)
    return db.execute(select(func.count()).select_from(table)).scalar_one()
