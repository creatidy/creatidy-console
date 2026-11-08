.PHONY: help install dev preview test check build start bootstrap
.DEFAULT_GOAL := help

help:
	@printf '%s\n' \
	  'make install  Install exact locked public dependencies with npm ci' \
	  'make dev      Start the standalone Vite UI at http://127.0.0.1:5173' \
	  'make preview  Inspect dist at http://127.0.0.1:4173 after make build' \
	  'make test     Run deterministic security, UI, tooling and workflow tests' \
	  'make check    Format, Markdown, local links, secrets, types, tests, temporary build' \
	  'make build    Build dist with project and runtime dependency licenses'
	@printf '%s\n' 'make bootstrap  Issue one local owner setup authority' 'make start      Start the authenticated application server'

install:
	npm ci

dev:
	npm run dev

preview:
	npm run preview

test:
	npm test

check:
	@tmp=$$(mktemp -d /tmp/creatidy-check.XXXXXXXX) || exit 1; trap 'rm -rf "$$tmp"' EXIT; \
	  env -i PATH="$(PATH)" HOME="$$tmp" TMPDIR="$$tmp" \
	  npm_config_cache="$$tmp/cache" npm_config_userconfig=/dev/null \
	  npm_config_globalconfig="$$tmp/global-npmrc" npm_config_offline=true npm run check

build:
	npm run build

start:
	npm start

bootstrap:
	npm run bootstrap
