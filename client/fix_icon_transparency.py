"""
fix_icon_transparency.py
Removes white/near-white background from build/icon.png and regenerates icon.ico.
Usage: python fix_icon_transparency.py
Requirements: pip install Pillow
"""
from PIL import Image
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PNG_SRC  = os.path.join(BASE, 'build', 'icon.png')
PNG_DEST = os.path.join(BASE, 'build', 'icon.png')
ICO_DEST = os.path.join(BASE, 'build', 'icon.ico')
PUBLIC_PNG = os.path.join(BASE, 'public', 'logo.png')
PUBLIC_ICO = os.path.join(BASE, 'public', 'icon.ico')
PUBLIC_FAV64 = os.path.join(BASE, 'public', 'favicon-64.png')


def remove_white_bg(img, threshold=240):
    """
    Converts near-white pixels to fully transparent.
    Pixels with R, G, B all >= threshold are treated as background.
    """
    img = img.convert('RGBA')
    data = img.load()
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = data[x, y]
            if a > 0 and r >= threshold and g >= threshold and b >= threshold:
                data[x, y] = (r, g, b, 0)
    return img


def make_ico(img, dest):
    """Save image as a multi-resolution .ico file."""
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(dest, format='ICO', sizes=sizes)
    print('  OK ICO salvo: ' + dest)


def process_icon(src, png_dest, ico_dest=None, threshold=240):
    print('\nProcessando: ' + src)
    if not os.path.exists(src):
        print('  ERRO Arquivo nao encontrado: ' + src)
        return

    img = Image.open(src).convert('RGBA')
    print('  Tamanho: ' + str(img.size))

    fixed = remove_white_bg(img, threshold)
    fixed.save(png_dest, 'PNG')
    print('  OK PNG com fundo transparente salvo: ' + png_dest)

    if ico_dest:
        make_ico(fixed, ico_dest)


def main():
    print('=' * 60)
    print('Concord Icon Transparency Fixer')
    print('=' * 60)

    # Fix build/icon.png -> build/icon.png + build/icon.ico
    process_icon(PNG_SRC, PNG_DEST, ICO_DEST, threshold=240)

    # Fix public/logo.png -> public/logo.png + public/icon.ico
    process_icon(PUBLIC_PNG, PUBLIC_PNG, PUBLIC_ICO, threshold=240)

    # Fix public/favicon-64.png (no ICO needed)
    if os.path.exists(PUBLIC_FAV64):
        process_icon(PUBLIC_FAV64, PUBLIC_FAV64, None, threshold=240)

    print('\n' + '=' * 60)
    print('CONCLUIDO! Recompile o Electron para aplicar o novo icone.')
    print('   Execute: pnpm run electron:build')
    print('=' * 60)


if __name__ == '__main__':
    main()
