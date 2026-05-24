.PHONY: build up down restart logs dev clean

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

restart: down up

logs:
	docker compose logs -f

dev:
	bunx astro dev --host 0.0.0.0

clean: down
	docker compose down --rmi all -v
