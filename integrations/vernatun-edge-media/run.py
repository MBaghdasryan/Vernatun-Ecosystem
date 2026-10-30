from service.app import app
from service.settings import settings
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=True,
    )
