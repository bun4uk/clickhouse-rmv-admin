.PHONY: help build up down logs ps clean dev-backend dev-frontend

help:
	@echo "RMV Admin — make commands"
	@echo "  make build         - Build images"
	@echo "  make up            - Start the stack (clickhouse + backend + frontend)"
	@echo "  make down          - Stop the stack"
	@echo "  make logs          - Tail logs"
	@echo "  make ps            - Show container status"
	@echo "  make clean         - Stop and remove volumes"
	@echo "  make dev-backend   - Run backend locally (uvicorn --reload)"
	@echo "  make dev-frontend  - Run frontend locally (vite dev server)"

build:
	docker compose build

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down -v

dev-backend:
	cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev
