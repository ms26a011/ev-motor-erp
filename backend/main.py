from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import reflect_phase_one_tables
from routes.master_data import router as master_data_router

app = FastAPI(title="EV Motor Manufacturing ERP API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    reflect_phase_one_tables()


@app.get("/")
def health_check():
    return {"message": "EV Motor Manufacturing ERP API is running."}


app.include_router(master_data_router)
