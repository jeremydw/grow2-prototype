nunjucks.configure('', {autoescape: true});

function getView(content) {
  let view = content['$view'];
  return view.replace('/views', 'views');
}

async function main() {
  // TODO: Determine doc based on route.
  let startTime = performance.now();
  let path = '/content/pages/home.yaml';
  let resp = await jQuery.get(path);
  let content = jsyaml.safeLoad(resp);
  let view = getView(content);
  let html = nunjucks.render(view, {
    'doc': content
  });
  let endTime = performance.now();
  document.write(html);
  document.close();
  console.log('Done in ' + Math.floor(endTime - startTime) + 'ms.');
};
main();
