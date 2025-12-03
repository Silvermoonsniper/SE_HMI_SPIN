# tell makefile to use bash
SHELL := /bin/bash

venv:  .venv/touchfile

.venv/touchfile: pyproject.toml
	uv venv --python 3.11
	uv sync --all-groups
	touch .venv/touchfile

test: venv
	uv run pytest test/ -v


clean:  ## 🧹 Clean up project
	rm -rf .venv


demo_GUI: venv
	source .venv/bin/activate; spin -c ./configuration -v
