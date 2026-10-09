import json, urllib.parse, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent
B = ROOT / 'build'
raw = (ROOT / 'icon_data.txt').read_text().split('\n')
apple = raw[raw.index('APPLE') + 1]
fav = raw[raw.index('FAV') + 1]
big = raw[raw.index('BIG') + 1]

manifest = {
    "name": "Yulengua", "short_name": "Yulengua",
    "start_url": ".", "display": "standalone", "orientation": "portrait",
    "background_color": "#ffffff", "theme_color": "#ffffff",
    "icons": [
        {"src": "data:image/png;base64," + apple, "sizes": "180x180", "type": "image/png"},
        {"src": "data:image/png;base64," + big, "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    ],
}
mdata = "data:application/manifest+json," + urllib.parse.quote(json.dumps(manifest, ensure_ascii=False), safe="")

parts = ['01_head.html', '02_core.js', '02b_cloud.js', '03_api.js', '04_home.js',
         '05_reading.js', '05b_bo.js', '06_dialogue.js', '07_lookup.js', '07b_pulse.js',
         '08_lib.js', '09_tail.html']
out = ''.join((B / p).read_text() for p in parts)
fonts = (B / 'fonts.css').read_text().strip()      # 内嵌手写体子集（静态文件，不要手改）
out = out.replace('__APPLE__', apple).replace('__FAV__', fav).replace('__MANIFEST__', mdata)
out = out.replace('__FONTS__', fonts)

site = ROOT / 'site'
site.mkdir(exist_ok=True)
dest = site / 'index.html'
dest.write_text(out)
(ROOT / 'index.html').write_text(out)               # 仓库根目录这份才是 GitHub Pages 实际发布的

src_w = ROOT / 'words'
if src_w.is_dir():
    (site / 'words').mkdir(exist_ok=True)
    for f in src_w.glob('*'):
        if f.is_file(): shutil.copy2(f, site / 'words' / f.name)

print('built', dest, len(out), 'chars')
