var _ENV = nunjucks.configure('../', {
  autoescape: true,
  web: {
    async: true
  }
});

_ENV.addFilter('resolve', async function(resolver, cb) {
  await resolver.resolve();
  cb(null, resolver);
}, true);

_ENV.addFilter('localize', function(str) {
  return str;
});

_ENV.addFilter('json', function(obj) {
  return JSON.stringify(obj);
});


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


var DocYamlType = new jsyaml.Type('!g.doc', {
  kind: 'scalar',
  construct: function(path) {
    return getDoc(path);
  },
  instanceOf: Doc
});


var StaticYamlType = new jsyaml.Type('!g.static', {
  kind: 'scalar',
  construct: function(data) {
    data = data || {};
    return new Static(data);
  },
  instanceOf: Static
});


var schema = jsyaml.Schema.create([
  DocYamlType, 
  StaticYamlType
]);


function getDoc(path) {
  if (_DOC_CACHE.has(path)) {
    return _DOC_CACHE.get(path);
  }
  let doc = new Doc(path);
  _DOC_CACHE.set(path, doc);
  return doc;
}


function getStatic(path) {
  return new Static(path);
}


function normalizeView(content) {
  let view = content['$view'] || '/views/base.html';
  return view.replace('/views', 'views');
}


function gettext(content) {
  return content;
}


function Static(path) {
  this.path = path;
  this.url = path;
}


function Url() {
  this.path = '/#TODO';
};


Url.prototype.toString = function() {
  return this.path;
};


function Collection(path) {
  this.path = path;
  this.fields = null;
  this.resolved = false;
}


function Doc(path) {
  this.path = path;
  this.fields = null;
  this.resolved = false;

  this.url = new Url();
}


function Routes(path) {
  this.path = path;
  this.trie = new Trie();
  this.doc_ = getDoc(path);
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
    return getDoc(data.collection + match.params['base'] + '.yaml');
  }
};


Routes.prototype.resolve = async function() {
  await this.doc_.resolve();
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: I hacked trie.js to allow for this second argument to put
    // arbitrary data on the matched nodes.
    this.trie.define(route.pattern, route);
  }.bind(this));
}


function Pod() {
  this.routes = new Routes('/routes.yaml');
}


Doc.prototype.populate = function() {
  for (var property in this.fields) {
    // TODO: Handle builtins somehow.
    let cleanProperty = property.replace('$', '');
    this[cleanProperty] = this.fields[property];
  }
};


Doc.prototype.toString = function() {
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
  console.log('Resolving', this.path);
  await this._resolve();
  async function cb(obj) {
    if (obj.resolve) {
      await obj.resolve();
    }
  }
  await iterate(this.fields, cb);
};


Doc.prototype._resolve = async function() {
  if (_HTTP_CACHE.has(this.path)) {
    var resp = _HTTP_CACHE.get(this.path);
  } else {
    var resp = await jQuery.get(this.path);
    _HTTP_CACHE.set(this.path, resp);
  }
  let fields = await jsyaml.load(resp, {schema: schema});
  this.fields = fields;
  this.populate();
  this.resolved = true;
};


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


async function main() {
  let startTime = performance.now();

  // Make a pod and resolve the routes from /routes.yaml.
  let pod = new Pod();
  await pod.routes.resolve();

  // Get the doc that corresponds to the URL.
  let doc = pod.routes.match(window.location.pathname);

  await doc.resolve();
  let endTime = performance.now();
  console.log('Loaded: ' + Math.floor(endTime - startTime) + 'ms');

  // Render the doc and write the output to the browser document.
  startTime = performance.now();
  let view = normalizeView(doc);
  let html = _ENV.render(view, {
    'doc': doc,
    'g': {
      'doc': getDoc,
      'static': getStatic
    },
    '_': gettext
  }, function(err, res) {
    let endTime = performance.now();
    document.write(res);
    document.close();
    console.log('Rendered: ' + Math.floor(endTime - startTime) + 'ms');
  });
};
main();
