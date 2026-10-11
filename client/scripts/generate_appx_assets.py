import os
from PIL import Image

def generate_assets():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icon_png = os.path.join(base_dir, 'build', 'icon.png')
    appx_dir = os.path.join(base_dir, 'build', 'appx')
    os.makedirs(appx_dir, exist_ok=True)

    if not os.path.exists(icon_png):
        raise FileNotFoundError(f"Icon not found at: {icon_png}")

    img = Image.open(icon_png).convert('RGBA')

    # Define asset specifications: name -> (width, height, is_wide)
    specs = {
        'Square44x44Logo.png': (44, 44),
        'Square150x150Logo.png': (150, 150),
        'StoreLogo.png': (50, 50),
        'LargeTile.png': (310, 310),
        'SmallTile.png': (71, 71),
        'BadgeLogo.png': (24, 24),
    }

    # Square assets: fit into square canvas
    for name, size in specs.items():
        out_path = os.path.join(appx_dir, name)
        resized = img.copy()
        resized.thumbnail(size, Image.Resampling.LANCZOS)
        # Center in exact size transparent canvas
        canvas = Image.new('RGBA', size, (0, 0, 0, 0))
        offset = ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2)
        canvas.paste(resized, offset, resized)
        canvas.save(out_path, 'PNG')
        print(f"Generated {name} ({size[0]}x{size[1]})")

    # Wide assets: Wide310x150Logo.png (310x150)
    wide_size = (310, 150)
    resized_wide = img.copy()
    resized_wide.thumbnail((150, 150), Image.Resampling.LANCZOS)
    canvas_wide = Image.new('RGBA', wide_size, (0, 0, 0, 0))
    offset_wide = ((wide_size[0] - resized_wide.width) // 2, (wide_size[1] - resized_wide.height) // 2)
    canvas_wide.paste(resized_wide, offset_wide, resized_wide)
    canvas_wide.save(os.path.join(appx_dir, 'Wide310x150Logo.png'), 'PNG')
    print("Generated Wide310x150Logo.png (310x150)")

    # SplashScreen.png (620x300) with background color matching app #1e1f22
    splash_size = (620, 300)
    resized_splash = img.copy()
    resized_splash.thumbnail((200, 200), Image.Resampling.LANCZOS)
    canvas_splash = Image.new('RGBA', splash_size, (30, 31, 34, 255))
    offset_splash = ((splash_size[0] - resized_splash.width) // 2, (splash_size[1] - resized_splash.height) // 2)
    canvas_splash.paste(resized_splash, offset_splash, resized_splash)
    canvas_splash.save(os.path.join(appx_dir, 'SplashScreen.png'), 'PNG')
    print("Generated SplashScreen.png (620x300)")

    print("\nAll AppX assets generated successfully in:", appx_dir)

if __name__ == '__main__':
    generate_assets()
