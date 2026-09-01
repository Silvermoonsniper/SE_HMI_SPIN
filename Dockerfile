# Use Python 3.11 as base image
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim as baseimage

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

FROM baseimage AS deps
# Create virtual environment and install dependencies using uv
RUN uv venv --python 3.11 && \
    uv sync --all-groups

# Build the React + TypeScript frontend (served by the FastAPI server as a SPA)
FROM node:22-alpine AS frontend_build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM deps AS all_deps
# Copy application files
COPY . /app
# Overlay the built frontend (dist is gitignored and excluded from the context copy)
COPY --from=frontend_build /app/frontend/dist /app/frontend/dist

# Create necessary directories and files if they don't exist
RUN mkdir -p /app/configuration && \
    touch /app/configuration/nodes.json && \
    touch /app/configuration/device_params.json

# Final application image target used by the GitLab publish job
FROM all_deps AS se_hmi_spin    
# Expose the port that spin server runs on (configured in conf.py as 8000)
EXPOSE 8000
EXPOSE 8001

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Activate virtual environment and run the application using uv run
CMD ["uv", "run", "spin", "-c", "./configuration", "-v"]
