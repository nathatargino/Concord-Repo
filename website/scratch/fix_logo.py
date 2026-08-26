from PIL import Image

def remove_black_bg_sharp(input_path, output_path):
    try:
        img = Image.open(input_path).convert("RGBA")
        data = img.getdata()
        new_data = []
        for item in data:
            r, g, b, a = item
            v = max(r, g, b)
            
            # Use a sharper threshold to avoid a dirty/dark halo on light backgrounds
            if v < 60:
                new_data.append((0, 0, 0, 0))
            # Very fast transition to avoid semi-transparent dark pixels
            elif v < 75:
                alpha = int((v - 60) * 255 / (75 - 60))
                new_data.append((r, g, b, alpha))
            else:
                new_data.append((r, g, b, 255))
                
        img.putdata(new_data)
        img.save(output_path, "PNG")
        print("Logo processed with sharper transparency successfully!")
    except Exception as e:
        print("Error processing logo:", e)

remove_black_bg_sharp('assets/logo.jpg', 'assets/logo.png')
