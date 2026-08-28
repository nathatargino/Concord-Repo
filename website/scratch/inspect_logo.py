from PIL import Image

def inspect(img_path):
    img = Image.open(img_path)
    print("Format:", img.format, "Size:", img.size, "Mode:", img.mode)
    # Check top-left corner pixels
    pixels = [img.getpixel((x, y)) for y in range(10) for x in range(10)]
    print("Top-left pixels sample:", pixels[:10])

inspect('assets/logo.png')
