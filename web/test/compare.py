"""Compare every page served by the local server with the static build (title, canonical, description, text)."""
import re,urllib.request,urllib.parse,pathlib,html
site=pathlib.Path(__file__).resolve().parents[2]/'site'; bad=0; n=0
for sm in ['page','post','category','post_tag']:
  for loc in re.findall('<loc>([^<]+)</loc>',(site/f'{sm}-sitemap.xml').read_text()):
    path=urllib.parse.unquote(urllib.parse.urlsplit(loc).path)
    f=site/'index.html' if path=='/' else site/path.strip('/')/'index.html'
    old=f.read_text()
    try: new=urllib.request.urlopen('http://localhost:3000'+urllib.parse.quote(path)).read().decode()
    except Exception as e: print('ERR',path,e); bad+=1; continue
    n+=1
    for pat in [r'<title>(.*?)</title>', r'<link rel="canonical" href="([^"]+)"', r'<meta name="description" content="([^"]*)"']:
      a=html.unescape(re.search(pat,old).group(1)); b=html.unescape(re.search(pat,new).group(1))
      if a!=b: print("DIFF",pat[:12],path,"|",urllib.parse.unquote(a),"|",urllib.parse.unquote(b)); bad+=1
    strip=lambda h: re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',html.unescape(re.search(r'<main id="main">(.*)</main>',h,re.S).group(1)))).strip()
    if strip(old)!=strip(new): print('MAIN TEXT DIFF',path); bad+=1
print(n,'pages checked,',bad,'problems')
