FROM python:3.13-slim

LABEL maintainer="Max"
LABEL description="ai-service"

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y bash

COPY requirements/ ./requirements/prod.txt
RUN pip install --no-cache-dir -r requirements/prod.txt
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
