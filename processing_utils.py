"""Pure processing helpers kept separate for lightweight unit testing."""
import re
from collections import Counter
from PIL import Image

def word_frequency(text: str):
    words = re.findall(r"[\w']+", text.lower(), flags=re.UNICODE)
    return {word: count for word, count in Counter(words).most_common(100)}

def resize_standard(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Fit within a standard bounding box without distorting aspect ratio."""
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy
