# Use Python 3.11 as base image
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml .
COPY uv.lock ./

# Create virtual environment and install dependencies using uv
RUN uv venv --python 3.11 && \
    uv sync --all-groups

# Copy application files
COPY . /app

# Create necessary directories and files if they don't exist
RUN mkdir -p /app/configuration && \
    touch /app/configuration/nodes.json && \
    touch /app/configuration/device_params.json

# Expose the port that spin server runs on (configured in conf.py as 8000)
EXPOSE 8000
EXPOSE 8001

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Activate virtual environment and run the application using uv run
CMD ["uv", "run", "spin", "-c", "./configuration", "-v"]
