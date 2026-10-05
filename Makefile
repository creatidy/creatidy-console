.PHONY: help install dev preview test check build
.DEFAULT_GOAL := help

help:
	@printf '%s\n' \
	  'make install  Install exact locked public dependencies with npm ci' \
	  'make dev      Start the bootstrap at http://127.0.0.1:5173' \
	  'make preview  Inspect dist at http://127.0.0.1:4173 after make build' \
	  'make test     Run deterministic scaffold and tooling tests' \
	  'make check    Format, Markdown, local links, secrets, types, tests, temporary build' \
	  'make build    Build dist with project and runtime dependency licenses'

install:
	npm ci

dev:
	npm run dev

preview:
	npm run preview

test:
	npm test

check:
	npm run check

build:
	npm run build
