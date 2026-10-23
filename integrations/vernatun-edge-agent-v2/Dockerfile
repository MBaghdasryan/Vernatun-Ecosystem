FROM python:3.12-alpine
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY service /app/service
COPY config /app/config
RUN mkdir -p /app/data
ENV PYTHONUNBUFFERED=1
EXPOSE 8092
CMD ["python", "/app/service/agent.py"]
