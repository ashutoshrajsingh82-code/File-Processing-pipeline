import io
import pytest
from PIL import Image
from processing_utils import word_frequency, resize_standard
from security import validate_webhook_url

def test_word_frequency_is_case_insensitive_and_bounded():
    assert word_frequency("Cat cat DOG dog dog") == {"dog": 3, "cat": 2}

def test_resize_standard_preserves_aspect_ratio():
    image = Image.new("RGB", (1600, 800), "white")
    resized = resize_standard(image, (800, 800))
    assert resized.size == (800, 400)

def test_webhook_requires_https():
    with pytest.raises(ValueError, match="HTTPS"):
        validate_webhook_url("http://example.com/callback")

def test_webhook_rejects_localhost():
    with pytest.raises(ValueError, match="publicly routable"):
        validate_webhook_url("https://localhost/callback")

def test_webhook_rejects_private_ip():
    with pytest.raises(ValueError, match="public IP"):
        validate_webhook_url("https://127.0.0.1/callback")
