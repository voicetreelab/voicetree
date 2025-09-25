import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Soniox Temporary API Key Service",
    description="FastAPI server for generating temporary Soniox API keys",
    version="1.0.0",
)

# Add CORS middleware to allow requests from React app
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",  # Allow all localhost ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TemporaryKeyResponse(BaseModel):
    apiKey: str


class ErrorResponse(BaseModel):
    error: str


@app.post(
    "/v1/auth/temporary-api-key",
    response_model=TemporaryKeyResponse,
    responses={400: {"model": ErrorResponse}},
)
async def generate_temporary_api_key():
    """
    Generate a temporary API key for Soniox WebSocket transcription.

    You don't want to expose the API key to the client, so we generate a temporary one.
    Temporary API keys are then used to initialize the RecordTranscribe instance on the client.
    """
    # Check if SONIOX_API_KEY environment variable is set
    soniox_api_key = os.getenv("SONIOX_API_KEY")
    if not soniox_api_key:
        raise HTTPException(status_code=400, detail="SONIOX_API_KEY is not set")

    # Get SONIOX_API_HOST or use default
    soniox_api_host = os.getenv("SONIOX_API_HOST", "https://api.soniox.com")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{soniox_api_host}/v1/auth/temporary-api-key",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {soniox_api_key}",
                },
                json={
                    "usage_type": "transcribe_websocket",
                    "expires_in_seconds": 60,
                },
            )

            # Check if the request was successful
            response.raise_for_status()

            # Parse the response
            data = response.json()

            return TemporaryKeyResponse(apiKey=data["api_key"])

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Soniox API error: {e.response.text}",
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Request error: {str(e)}")
    except KeyError:
        raise HTTPException(
            status_code=500, detail="Invalid response format from Soniox API"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
