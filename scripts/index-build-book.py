import json,logging,re,hashlib,shutil,sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader
logging.getLogger('pypdf').setLevel(logging.ERROR)
source=Path(sys.argv[1]).resolve()
root=Path(__file__).resolve().parents[1]
output=root/'apps/ios/DisplayRefillKit/Sources/DisplayRefillCore/Resources'
r=PdfReader(source); entries=[]
with pdfplumber.open(source) as doc:
 for idx,pg in enumerate(doc.pages):
  text=(r.pages[idx].extract_text() or '').strip()
  words=pg.extract_words(extra_attrs=['size'])
  header=[w for w in words if w['top']<110 and w['size']>=18]
  header.sort(key=lambda w:(round(w['top']/5),w['x0']))
  title=' '.join(w['text'] for w in header).strip() or next((l.strip() for l in text.splitlines() if l.strip() and not re.match(r'^\d+$',l.strip())),f'Page {idx+1}')
  title=re.sub(r'\s+',' ',title)
  # Consecutive pages with the same source heading form one lookup entry.
  normalized=re.sub(r'[^a-z0-9]','',title.lower())
  group='Fruit' if 62<=idx<181 else 'Salads' if 181<=idx<311 and 'salad' in title.lower() else 'Vegetables' if 181<=idx<311 else 'Guides'
  if idx == 300: group='Fruit'  # Berry Tray appendix in this source edition.
  if entries and normalized==entries[-1]['key'] and group==entries[-1]['category']:
   entries[-1]['pages'].append(idx+1);entries[-1]['text']+='\n\n'+text
  else: entries.append(dict(id=f'page-{idx+1}',title=title,category=group,pages=[idx+1],text=text,key=normalized))
for e in entries:e.pop('key')
output.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,output/'BuildBook.pdf')
(output/'BuildBookIndex.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2))
receipt=dict(source=str(source),sha256=hashlib.sha256(source.read_bytes()).hexdigest(),page_count=len(r.pages),entries=len(entries),textless_pages=[i+1 for i,pg in enumerate(r.pages) if not (pg.extract_text() or '').strip()],mapping='Physical PDF page numbers, not printed page numbers; paired only when consecutive headings match. Original PDF unchanged.')
(root/'context/pilot/build-book-import.json').write_text(json.dumps(receipt,indent=2))
print('Indexed',len(entries),'entries;',len(r.pages),'pages. Examples:',[(e['title'],e['pages']) for e in entries if 'Watermelon Chunks Cup' in e['title']])
