/*
Renders templates & assets for web or email usage.
+ Polyfills JS.
+ Converts JSX HTML to Aviation.element function.


Packages required:
+ fs (inbuilt)
+ glob
+ path (inbuilt)
+ mime
+ ejs
+ handlebars
+ sass
+ postcss
+ autoprefixer
+ html-minifier
+ csso
+ terser
+ @babel/core
+ @babel/preset-env
+ @babel/preset-react
+ babel-preset-minify

*/


/********************************************* SETUP FUNCTIONS **********************************************/


//Load required packages.
const fs = require("fs")
const glob = require("glob")
const pathLib = require("path")
const mime = require("mime")
const babel = require("@babel/core")
const ejs = require("ejs")
const handlebars = require("handlebars")
const sass = require("sass")
const postcss = require("postcss")
const optimizeCSS = postcss([require("autoprefixer")])
const htmlMinifier = require("html-minifier").minify
const csso = require("csso")
const terser = require("terser")


//Export primary function.
module.exports = load
module.exports.compile = compile
module.exports.minify = minify





/********************************************* PRIMARY FUNCTIONS **********************************************/


/*
Loads a folder & compiles it.
*/
function load(folder, options = {}) {
  var pages = {}
  if(typeof folder == "object") {
    var files = folder
    options.root = options.root || pathLib.dirname(files[0])
  }
  else {
    var files = glob.sync(pathLib.join(folder, "/**/*"))
    options.root = options.root || folder
  }

  //Handle each file.
  for(var i in files) {
    if(fs.lstatSync(files[i]).isDirectory()) { continue }
    var path = files[i]

    //Check if this file is in a folder that should be skipped.
    if(options.skip) {
      var skip = false
      for(var i in options.skip) { if(path.includes(pathLib.join("/", options.skip[i]))) { skip = true; break } }
      if(skip) { continue }
    }

    //Load file, compile it & minify.
    var page = compile(path, options.root, {minify: options.minify})

    //Make sure HTML is accessible from base paths.
    if(options.hideHTMLExtension == undefined || options.hideHTMLExtension) {
      if(page.file.includes("/index.html")) { page.file = page.file.replace("/index.html", "") }
      else if(page.file.includes(".html")) { page.file = page.file.replace(".html", "") }
      if(!page.file) { page.file = "/" }
    }

    //Minify & add to pages.
    pages[page.file] = page
  }

  //Create a function to serves these assets.
  var handleRequest = function(thisOptions = {}) {
    var vars = options.vars || {}
    if(thisOptions.vars) { vars = thisOptions.vars }

    return async function(req, res, next) {
      try {
        if(!["GET", "OPTIONS", "HEAD"].includes(req.method)) {
          if(thisOptions.displayErrors || options.displayErrors) { return res.status(404).send("404 - No such page") }
          return next()
        }

        var page = pages[(req.params.file ? "/" + req.params.file + req.params[0] : null) || req.path]
        if(!page) {
          if(thisOptions.displayErrors || options.displayErrors) { return res.status(404).send("404 - No such page") }
          return next()
        }

        //Render page if required.
        content = page.content
        if(page.toRender) {
          var thisVars = vars[page.file] || vars
          if(thisOptions.getVars) { thisVars = await thisOptions.getVars(page, req) }
          content = await content(thisVars)
        }

        res.status(200).set({"Content-Type": page.type, "Cache-Control": "max-age=" + (thisOptions.cache || options.cache || 3600)}).send(content)
      } catch (e) { next(e) }
    }
  }


  return {pages, handleRequest}
}



/*
Loads a file & compiles it into a template to render.
+ Minifies assets.
*/
function compile(path, root, options = {}) {
  //Check if result should be minfied.
  if(typeof options.minify == "undefined") {
    if((typeof environment == "string" && environment == "production") || (process.env.NODE_ENV == "production")) {
      options.minify = true
    }
  }

  //Figure out absolute file name & root folder, also load content.
  path = pathLib.resolve(path)
  if(!root) { root = pathLib.dirname(path) }
  else { root = pathLib.resolve(root) }
  var name = path.replace(root, ""), content = fs.readFileSync(path), type

  //Handle JS/JSX polyfilling.
  if(name.includes(".js")) {
    var presets = [["@babel/preset-react", {pragma: "Aviation.element"}], "@babel/preset-env"]
    //if(options.minify) { presets.push("minify") }

    content = babel.transformSync(String(content), {filename: name, cwd: root, presets: presets, compact: true, minified: options.minify, comments: !options.minify}).code
    name = name.replace(".jsx", "").replace(".js", ""), type = "application/javascript"
    if(!name.includes(".js")) { name += ".js" }
  }

  //Handle HTML templating for EJS & Handlebars.
  if(name.includes(".ejs") || name.includes(".handlebars")) {
    var content = String(content), orginally = null, isAsync = false

    //First minify source HTML.
    if(options.minify) { content = minify(content, "text/html") }

    //Convert into template & add properties.
    if(name.includes(".ejs")) {
      name = name.replace(".ejs", (name.includes(".html") ? "" : ".html")), orginally = "ejs"
      content = ejs.compile(content, {async: true, filename: path, root: root})
      isAsync = true
    }
    else if(name.includes(".handlebars")) {
      name = name.replace(".handlebars", (name.includes(".html") ? "" : ".html")), orginally = "handlebars"
      content = handlebars.compile(content)
    }

    //Return with metadata.
    return {toRender: true, orginally, file: name, type: "text/html", content, isAsync, path}
  }

  //Handle SASS rendering.
  if(name.includes(".sass") || name.includes(".scss")) {
    content = sass.renderSync({data: String(content), includePaths: [pathLib.dirname(path)], indentedSyntax: name.includes(".sass")}).css
    name = name.replace(".sass", (name.includes(".css") ? "" : ".css")).replace(".scss", (name.includes(".css") ? "" : ".css")), type = "text/css"
  }

  //Handle CSS compatibility optimizations.
  if(options.minify && name.includes("css")) {
    content = optimizeCSS.process(String(content)).css
  }

  //Get type & minify assets.
  if(!type) { type = mime.getType(name) || "text/plain" }
  if(options.minify) { content = minify(content, type) }

  return {file: name, type, content, path}
}



/*
Minifies an asset.
*/
function minify(content, type) {

  if(type == "text/html") {
    content = htmlMinifier(String(content), {collapseWhitespace: true, minifyCSS: true, minifyJS: function(content) { var min = terser.minify(content); if(!min.error) { return min.code }; }, removeComments: true, removeRedundantAttributes: true})
  }
  else if(type == "text/css") {
    content = csso.minify(content).css
  }
  else if(type == "application/javascript") {
    var min = terser.minify(String(content))
    if(!min.error) { content = min.code }
  }

  return content
}
