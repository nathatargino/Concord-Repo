from PIL import Image

def remove_black_bg(input_path, output_path):
    try:
        img = Image.open(input_path).convert("RGBA")
        data = img.getdata()
        new_data = []
        for item in data:
            r, g, b, a = item
            alpha = max(r, g, b)
            if alpha > 0:
                nr = int(r * 255 / alpha)
                ng = int(g * 255 / alpha)
                nb = int(b * 255 / alpha)
                # cap to 255
                nr = min(255, nr)
                ng = min(255, ng)
                nb = min(255, nb)
                new_data.append((nr, ng, nb, alpha))
            else:
                new_data.append((0, 0, 0, 0))
        img.putdata(new_data)
        img.save(output_path, "PNG")
        print("Success")
    except Exception as e:
        print("Error:", e)

remove_black_bg('assets/logo.jpg', 'assets/logo.png')
