# Generates abstract placeholder artwork for the mock exhibitors (spec §6 allows mock data).
import random
from PIL import Image, ImageDraw
PAL = [("#FF5A1F","#FFE3D3"),("#1FB89A","#D6F5EE"),("#6D4CFF","#E6E0FF"),("#FFB703","#FFF1C9"),("#14123B","#E9E7F5"),("#E63973","#FCDDE8")]
INK="#14123B"
def art(i, path):
    rnd = random.Random(i*7919)
    fg,bg = PAL[i % len(PAL)]
    acc = PAL[(i+2) % len(PAL)][0]
    W,H = 800,600
    im = Image.new("RGB",(W,H),bg); d = ImageDraw.Draw(im)
    # dotted blueprint grid
    for x in range(20,W,40):
        for y in range(20,H,40): d.ellipse([x-2,y-2,x+2,y+2],fill=fg if rnd.random()<.15 else "#00000014")
    kind = i % 4
    if kind==0:
        r=rnd.randint(150,220); cx,cy=rnd.randint(300,500),rnd.randint(250,350)
        d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=fg); d.ellipse([cx-r//2,cy-r//2,cx+r//2,cy+r//2],fill=bg)
        d.rectangle([cx-20,cy-r-60,cx+20,cy+r+60],fill=INK)
    elif kind==1:
        for k in range(6):
            x=100+k*110; h=rnd.randint(120,420)
            d.rounded_rectangle([x,H-60-h,x+80,H-60],radius=18,fill=fg if k%2 else acc)
    elif kind==2:
        pts=[(rnd.randint(80,720),rnd.randint(80,520)) for _ in range(3)]
        d.polygon(pts,fill=fg); d.ellipse([500,80,700,280],fill=acc)
        d.line([(80,520),(720,80)],fill=INK,width=14)
    else:
        for k in range(5):
            r=260-k*48; d.ellipse([400-r,300-r,400+r,300+r],outline=fg if k%2==0 else INK,width=22)
        d.rectangle([0,H-90,W,H],fill=acc)
    # gear-ish badge
    gx,gy=rnd.randint(80,180),rnd.randint(80,160)
    for a in range(8):
        import math; t=a*math.pi/4
        d.rectangle([gx+math.cos(t)*42-9,gy+math.sin(t)*42-9,gx+math.cos(t)*42+9,gy+math.sin(t)*42+9],fill=INK)
    d.ellipse([gx-40,gy-40,gx+40,gy+40],fill=INK); d.ellipse([gx-16,gy-16,gx+16,gy+16],fill=bg)
    im.save(path,"JPEG",quality=82)
for i in range(12): art(i, f"images/ex{i+1:02d}.jpg")
