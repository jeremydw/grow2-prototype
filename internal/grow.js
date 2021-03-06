if (window.location.href.indexOf('localhost') > -1) {
  var ENV = 'local';
} else {
  var ENV = 'github';
}

var GITHUB_ROOT = 'https://raw.githubusercontent.com/jeremydw/grow2-prototype/master'; 
var REFRESH_CACHE = new URL(window.location.href).searchParams.has('refresh');


/**
 * Helper to deep walk objects.
 */

async function iterate(obj, cb) {
  for (var property in obj) {
    await cb(obj);
    if (obj.hasOwnProperty(property)) {
      var val = obj[property];
      if (typeof val == 'object') {
	await iterate(val, cb);
      }
    }
  }
}


function base(path) {
  return path.split('/', -1).pop().split('.')[0];
}


/** To get around a GitHub mimetype issue, replace <link> style tags with inlined CSS. */
function replaceLinkedStyles(browserDoc) {
  var linkEls = browserDoc.querySelectorAll('link[href^="' + GITHUB_ROOT + '"]');
  [].forEach.call(linkEls, async function(el) {
    var url = el.getAttribute('href');
    var resp = await jQuery.get(url);
    var inlineEl = browserDoc.createElement('style');
    inlineEl.textContent = resp;
    el.parentNode.replaceChild(inlineEl, el);
  });
};


/**
 * Cache to avoid round-trips to the server for files.
 */


function Cache() {
  this.fields = {};
};


Cache.prototype.set = function (key, val) {
  this.fields[key] = val;
};


Cache.prototype.has = function (key) {
  return this.fields.hasOwnProperty(key);
};


Cache.prototype.get = function (key) {
  return this.fields[key];
};


const _DOC_CACHE= new Cache();
const _HTTP_CACHE = new Cache();


/**
 * Custom YAML types.
 */


var DocYamlType = new jsyaml.Type('!g.doc', {
  kind: 'scalar',
  construct: function(path) {
    return Doc.get(path);
  },
  instanceOf: Doc
});


var StaticYamlType = new jsyaml.Type('!g.static', {
  kind: 'scalar',
  construct: function(path) {
    return Static.get(path);
  },
  instanceOf: Static
});


var schema = jsyaml.Schema.create([
  DocYamlType, 
  StaticYamlType
]);


/**
 * Static object.
 */


function Static(path) {
  this.path = path;
  this.ext = path.split('.').pop();
  this.base = base(path);
  this.basename = this.base + '.' + this.ext;
}


Static.prototype.url = function() {
  // Serve static files from GitHub.
  if (ENV == 'github') {
    return GITHUB_ROOT + this.path;
  }
  return pod.routes.buildStaticUrl(this);
};


Static.get = function(path) {
  return new Static(path);
}


/**
 * URL object.
 */


function Url(path, opts) {
  this.path = path;
};


Url.prototype.toString = function() {
  return this.path;
};


/**
 * Routes object.
 */


function Routes(path) {
  this.path = path;
  this.trie = new Trie();
  this.doc_ = Doc.get(path);
}


Routes.prototype.paths = function() {
  var paths = [];
  this.doc_.fields['routes'].forEach(function(route) {
    var pattern = route.pattern;
    // TODO: Support proper expansion of patterns.
    if (pattern.indexOf(':') == -1) {
      paths.push(pattern);
      return;
    }
    if (route.collection) {
      // TODO: List directory and get all paths.
    }
  })
  return paths;
}


Routes.prototype.match = function(path) {
  // Return the doc to render.
  let match = this.trie.match(path);
  if (!match.node) {
    throw Error('No pattern in /routes.yaml matches -> ' + path);
    return;
  }
  let data = match.node.data;

  if (data.doc) {
    return data.doc;
  } else if (data.collection) {
    // NOTE: So hacky. We should have methods to convert routes nicely.
    var collection = data.collection.replace('_blueprint.yaml', '');
    return Doc.get(collection + match.params['base'] + '.yaml');
  }
};


Routes.prototype.buildStaticUrl = function(staticObj) {
  var url = null;
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: Replace this with some sort of "isInRoute" to see if a route
    // definition matches a given static.
    if (staticObj.path.startsWith(route.static_dir)) {
      var pattern = route.pattern;
      pattern = pattern.replace(':base', staticObj.basename);
      url = new Url(pattern);
    }
  });
  return url;
}


Routes.prototype.buildUrl = function(doc) {
  var url = null;
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: Replace this with some sort of "isInRoute" to see if a route
    // definition matches a given document.
    if (route.doc == doc || route.collection == doc.collection_path) {
      var pattern = route.pattern;
      pattern = pattern.replace(':base', doc.base);
      url = new Url(pattern);
    }
  });
  return url;
}


Routes.prototype.resolve = async function() {
  await this.doc_.resolve();
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: I hacked trie.js to allow for this second argument to put
    // arbitrary data on the matched nodes.
    this.trie.define(route.pattern, route);
  }.bind(this));
}


/**
 * Pod object.
 */


function Pod() {
  this.routes = new Routes('/routes.yaml');

  // Could be any template language really.
  this.renderer = setupNunjucks();
}


Pod.prototype.resolve = async function() {
  let startTime = performance.now();
  // Resolve the routes from /routes.yaml.
  await this.routes.resolve();
  let endTime = performance.now();
  console.log('%cpod.resolve -> ' + Math.floor(endTime - startTime) + 'ms', 'background: black; color: white;');
}


Pod.prototype.buildAll = function(cb) {
  let paths = this.routes.paths();
  paths.forEach(function(path) {
    this.build(path, function(err, res) {
      if (cb) {
        cb(err, res);
      }
    });
  }.bind(this));
};


Pod.prototype.build = async function(path, cb) {
  console.log('Building -> ' + path);
  // Get the doc that corresponds to the URL path.
  let doc = this.routes.match(path);
  await doc.resolve();

  // Use these params for all template envs.
  let params = {
    '_': gettext,
    'doc': doc,
    'g': {
      'doc': Doc.get,
      'static': Static.get
    }
  }
  let template = doc.getView();

  startTime = performance.now();
  this.renderer.render(template, params, function(err, res) {
    cb(err, res);
    endTime = performance.now();
    console.log('%cpod.build -> ' + Math.floor(endTime - startTime) + 'ms', 'background: black; color: white;');
  });
}


/**
 * Document object.
 */


function Doc(path) {
  this.path = path;
  this.base = base(path);
  this.collection_path = path.replace(this.base + '.yaml', '_blueprint.yaml');

  this.fields = null;
  this.resolved = false;
}


Doc.prototype.url = function() {
  // pod is a global, but that's bad. Use a factory/builder paradigm to inject
  // the pod instance into the doc instead. Also, figure out a way to make the
  // URL lazy so we don't have to do this on object instantiation. Maybe make
  // it a function call instead? i.e. doc.url().
  return pod.routes.buildUrl(this);
};


Doc.get = function(path) {
  // Docs are a bit expensive with all the YAML fetching and parsing. Use a
  // global doc cache because once docs are resolved they don't change.
  if (_DOC_CACHE.has(path)) {
    return _DOC_CACHE.get(path);
  }
  let doc = new Doc(path);
  _DOC_CACHE.set(path, doc);
  return doc;
}


Doc.prototype.populate = function() {
  for (var property in this.fields) {
    // TODO: Handle builtins somehow.
    let cleanProperty = property.replace('$', '');
    if (this.hasOwnProperty(cleanProperty)) {
      continue;
    }
    this[cleanProperty] = this.fields[property];
  }
};


Doc.prototype.toString = function() {
  // Star to indicate unresolved fields, useful for debugging.
  if (this.resolved) {
    return '<Doc [path=' + this.path + ']>';
  } else {
    return '<Doc* [path=' + this.path + ']>';
  }
};


Doc.prototype.resolve = async function () {
  if (this.resolved) {
    return;
  }
  console.log('Resolving ->', this.path);
  await this._resolve();
  async function cb(obj) {
    if (obj.resolve) {
      await obj.resolve();
    }
  }
  await iterate(this.fields, cb);
};


Doc.prototype._resolve = async function() {
  var resp = await idbKeyval.get(this.path);
  if (typeof resp == 'undefined' || REFRESH_CACHE) {
    // NOTE: We want to abstract this out so we can use fs in the Node env.
    let path = this.path;
    if (ENV == 'github') {
      // Bust cache to force github refreshes.
      path = GITHUB_ROOT + this.path + '?cb=' + performance.now();
    }
    var resp = await jQuery.get(path);
    idbKeyval.set(this.path, resp);
  }
  let fields = await jsyaml.load(resp, {schema: schema});
  this.fields = fields;
  this.populate();
  this.resolved = true;
};


Doc.prototype.getView = function() {
  // TODO: Default should come from podspec.
  let view = this.fields['$view'] || '/views/base.html';
  return view.replace('/views', 'views');
};


function gettext(content) {
  return content;
}


/**
 * Set up the nunchucks env.
 */


var IndexedDbLoader = nunjucks.Loader.extend({
  async: true,
  init: function(root, opts) {
    this.webLoader = new nunjucks.WebLoader(root, opts);
  },
  getSource: async function(name, cb) {
    if (!REFRESH_CACHE) {
      var resp = await idbKeyval.get(name);
      if (resp) {
        cb(null, {
          'src': resp,
          'path': name
        });
        return;
      }
    }
    this.webLoader.getSource(name, function(err, result) {
      if (!err) {
        idbKeyval.set(name, result['src']);
      }
      cb(err, result);
    });
  }
});


function setupNunjucks() {
  // ../ is a hack. Get it working correctly. See the junk in server.js.
  var root = '../';
  if (ENV == 'github') {
    root = GITHUB_ROOT;
  }

  let env = new nunjucks.Environment([
    new IndexedDbLoader(root, {async: true})
  ], {
    async: true,
    autoescape: true
  });
  env.addFilter('resolve', async function(resolver, cb) {
    await resolver.resolve();
    cb(null, resolver);
  }, true);
  env.addFilter('localize', function(str) {
    return str;  // No-op.
  });
  env.addFilter('json', function(obj) {
    return JSON.stringify(obj);
  });
  return env;
}


// NOTE: This is global now, which is bad. Done this way so Docs, Routes, etc.
// can pull into the Pod object. What we should do instead is use a
// factory/builder method on the Pod, to always generate Docs, Objects, etc.
// that way, and then inject the Pod instance onto the Docs (like how Grow1
// works).
var pod = new Pod();


async function main() {
  // Render the doc and write the output to the browser document.
  await pod.resolve();
  pod.build(window.location.pathname, function(err, html) {
    // Preserve grow console.
    var grow = document.getElementById('grow');
    var el = grow.cloneNode(true);
    document.write(html);
    document.close();
    document.body.appendChild(el);
    // Hack to get this working with GitHub.
    replaceLinkedStyles(document);
  });
};


main();
