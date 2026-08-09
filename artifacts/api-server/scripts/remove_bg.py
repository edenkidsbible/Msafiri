#!/usr/bin/env python3
"""
remove_bg.py — AI-powered background removal for car images.

Usage:
  python3 remove_bg.py <input_file> <output_file>

Reads any image from input_file, writes a transparent PNG to output_file.
Uses rembg with the u2netp (portable) model — ~4 MB, much faster than
the full u2net (176 MB) on CPU, adequate quality for car silhouettes.
"""

import sys
from rembg import remove
from rembg.session_factory import new_session

def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input> <output>", file=sys.stderr)
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    # u2netp is the lightweight portable variant of U2-Net:
    #   - ~4 MB model vs 176 MB for u2net
    #   - 3-5× faster on CPU
    #   - slightly lower accuracy on complex edges but excellent for cars
    session = new_session("u2netp")
    result = remove(image_bytes, session=session)

    with open(output_path, "wb") as f:
        f.write(result)

if __name__ == "__main__":
    main()
