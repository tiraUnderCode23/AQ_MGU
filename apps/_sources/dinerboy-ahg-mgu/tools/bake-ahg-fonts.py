"""Bake the redistributable Roboto font using the real SDK atlas format."""
import importlib.util,json,pathlib
from fontTools.ttLib import TTFont
root=pathlib.Path(__file__).resolve().parents[1]
fontroot=root/'art/fonts';fontroot.mkdir(parents=True,exist_ok=True)
package=root/'node_modules/@fontsource/roboto'
for weight,label in [(400,'Regular'),(700,'Bold')]:
 font=TTFont(package/f'files/roboto-latin-{weight}-normal.woff')
 font.flavor=None;font.save(fontroot/f'Roboto-{label}.ttf')
spec=importlib.util.spec_from_file_location('bake',root/'kit/tools/bake_fonts.py')
bake=importlib.util.module_from_spec(spec);spec.loader.exec_module(bake)
bake.FONTDIR=str(fontroot)
for name,file in [('label','Roboto-Regular.ttf'),('bold','Roboto-Bold.ttf'),('num','Roboto-Regular.ttf'),('light','Roboto-Regular.ttf')]:
 data={'family':name,'source':file,'cacheKey':'ahg-roboto-v1','sizes':[bake.bake(file,None,size,bake.TEXT) for size in [16,20,24,32,44,64]]}
 (root/f'kit/runtime/fonts/{name}.json').write_text(json.dumps(data,separators=(',',':')))
 print('Baked',name)
for license in package.glob('*LICENSE*'):
 (root/'kit/runtime/fonts'/('Roboto-'+license.name)).write_bytes(license.read_bytes())
