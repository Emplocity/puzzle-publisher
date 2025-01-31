@import("constants.js")
@import("lib/utils.js")
@import("exporter/exporter-build-html.js")
@import("exporter/PZLayer.js")
@import("exporter/PZArtboard.js")
@import("exporter/PZPage.js")
@import("exporter/PZDoc.js")
@import("exporter/publisher.js") // we need it to run resize.sh script

var exporter = undefined



class Exporter {

  constructor(selectedPath, ndoc, page, exportOptions,context) {       
    this.Settings = require('sketch/settings');
    this.Sketch = require('sketch/dom');
    this.ndoc = ndoc
    this.doc = this.Sketch.fromNative(ndoc)
    this.page = page;
    this.context = context;
    this.customArtboardFrame = undefined
    this.siteIconLayer = undefined
    this.myLayers = []
    this.jsStory = '';    
    this.errors = []
    this.warnings = []
    this.exportedImages = []

    // workaround for Sketch 52s
    this.docName = this._clearCloudName(this.ndoc.cloudName())
    let posSketch =  this.docName.indexOf(".sketch")
    if(posSketch>0){
      this.docName = this.docName.slice(0,posSketch)
    }
    // @workaround for Sketch 52

    this.prepareOutputFolder(selectedPath);

    this.exportOptions = exportOptions
    this._readSettings()


    this.filterAster = null==this.exportOptions || !('mode' in this.exportOptions) || Constants.EXPORT_MODE_SELECTED_ARTBOARDS!=this.exportOptions.mode

    // init global variable
    exporter = this
  }

  _readSettings() {
    if(this.exportOptions.customArtboardWidth >0 || this.exportOptions.customArtboardHeight>0){
        this.customArtboardFrame =  new Rectangle(0,0
            ,parseInt(this.exportOptions.customArtboardWidth,10)
            ,parseInt(this.exportOptions.customArtboardHeight,10)
        )
    }

    this.retinaImages = this.Settings.settingForKey(SettingKeys.PLUGIN_DONT_RETINA_IMAGES)!=1
    this.enabledJSON = this.Settings.settingForKey(SettingKeys.PLUGIN_DONT_SAVE_ELEMENTS)!=1
    this.disableFixedLayers = this.customArtboardFrame || this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_DISABLE_FIXED_LAYERS)==1

    let pluginSortRule = this.Settings.settingForKey(SettingKeys.PLUGIN_SORT_RULE)
    if(undefined==pluginSortRule) pluginSortRule = Constants.SORT_RULE_X
    const docCustomSortRule = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_CUSTOM_SORT_RULE)
    this.sortRule = undefined==docCustomSortRule || docCustomSortRule<0 ? pluginSortRule : docCustomSortRule

    let backColor = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_BACK_COLOR)
    if(undefined==backColor) backColor = ""
    this.backColor = backColor

    let serverTools = this.Settings.settingForKey(SettingKeys.PLUGIN_SERVERTOOLS_PATH)
    if(serverTools==undefined) serverTools = ''
    this.serverTools = serverTools    
  }


  logMsg(msg){
    if(!Constants.LOGGING) return
    log(msg)
  }


  logWarning(text){
    log("[ WARNING ] "+text)
    this.warnings.push(text)
  }

  logError(error){
    log("[ ERROR ] "+error)
    this.errors.push(error)
  }

  stopWithError(error){
    const UI = require('sketch/ui')
    UI.alert('Error', error)
    exit = true
  }

  _clearCloudName(cloudName)
  {
    let name = cloudName
    let posSketch =  name.indexOf(".sketch")
    if(posSketch>0){
      name = name.slice(0,posSketch)
    }
    return name
  }


  prepareFilePath(filePath,fileName)
  {
    const fileManager = NSFileManager.defaultManager();
    const targetPath = filePath + '/'+fileName;

    let error = MOPointer.alloc().init();
    if (!fileManager.fileExistsAtPath(filePath)) {
      if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(filePath, true, null, error)) {
        this.logError("prepareFilePath(): Can't create directory '"+filePath+"'. Error: "+error.value().localizedDescription());
        return undefined
      }
    }

    if (fileManager.fileExistsAtPath(targetPath)) {
      if (!fileManager.removeItemAtPath_error(targetPath, error)) {
        this.logError("prepareFilePath(): Can't remove old directory '"+targetPath+"'. Error: "+error.value().localizedDescription());
        return undefined
      }
    }
    return targetPath
  }


  copyStatic(resFolder) {    
    const fileManager = NSFileManager.defaultManager();    
    const targetPath = this.prepareFilePath(this._outputPath,resFolder);
    if(undefined==targetPath) return false
    
    const sourcePath = this.context.plugin.url().URLByAppendingPathComponent("Contents").URLByAppendingPathComponent("Sketch").URLByAppendingPathComponent(resFolder)
    //const sourcePath = this.context.plugin.url().URLByAppendingPathComponent("Contents").URLByAppendingPathComponent("Sketch").URLByAppendingPathComponent(resFolder).path();        
   
    let error = MOPointer.alloc().init();    
    if (!fileManager.copyItemAtPath_toPath_error(sourcePath, targetPath, error)) {
      log(error.value().localizedDescription());
      return this.logError("copyStatic(): Can't copy '"+sourcePath+"' to directory '"+targetPath+"'. Error: "+error.value().localizedDescription());
    }

    return true
  }

  generateJSStoryBegin(){
    const disableHotspots = this.Settings.settingForKey(SettingKeys.PLUGIN_DISABLE_HOTSPOTS)==1

    this.jsStory = 
    'var story = {\n'+
    '"docName": "'+ Utils.toFilename(this.docName)+'",\n'+
    '"docPath": "P_P_P",\n'+
    '"docVersion": "'+Constants.DOCUMENT_VERSION_PLACEHOLDER+'",\n'+
    '"hasRetina": '+(this.retinaImages?'true':'false') + ',\n'+
    '"serverToolsPath":"'+this.serverTools + '",\n'+
    '"disableHotspots": '+(disableHotspots?'true':'false') + ',\n'+
    '"pages": [\n';
  }

  // result: full path to file OR undefined
  createJSStoryFile(){
    const fileName = 'story.js';
    return this.prepareFilePath(this._outputPath + "/" + Constants.VIEWER_DIRECTORY,fileName);
  }

  // result: true OR false
  generateJSStoryEnd(){
    this.jsStory += 
     '   ]\n,'+
     '"resolutions": ['+(this.retinaImages?'2':'1')+'],\n'+
     '"title": "'+this.docName+'",\n'+
     ''+
     '"highlightLinks": false\n'+
    '}\n';

    const pathStoryJS = this.createJSStoryFile();
    log('generateJSStoryEnd: '+pathStoryJS)
    if(undefined==pathStoryJS) return false

    Utils.writeToFile(this.jsStory, pathStoryJS);

    return true
  }

  createMainHTML(){
    const buildOptions = {
        docName:            this.docName,
        serverTools:        this.serverTools,
        backColor:          this.backColor,
        centerContent:      this.Settings.settingForKey(SettingKeys.PLUGIN_POSITION) === Constants.POSITION_CENTER,
        loadLayers:         this.enabledJSON
    }    


    const docHideNav = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_CUSTOM_HIDE_NAV)
    buildOptions.hideNav = docHideNav==undefined||docHideNav==0?this.Settings.settingForKey(SettingKeys.PLUGIN_HIDE_NAV)==1 : docHideNav==2

    let commentsURL = this.Settings.settingForKey(SettingKeys.PLUGIN_COMMENTS_URL)
    if(commentsURL==undefined) commentsURL = ''
    buildOptions.commentsURL = commentsURL
    
    let googleCode = this.Settings.settingForKey(SettingKeys.PLUGIN_GOOGLE_CODE)
    if(googleCode==undefined) googleCode = ''
    buildOptions.googleCode = googleCode

    if(""==buildOptions.backColor) buildOptions.backColor = Constants.DEF_BACK_COLOR
  
    
    const s = buildMainHTML(buildOptions);

    const filePath = this.prepareFilePath(this._outputPath,'index.html');
    if(undefined==filePath) return false

    Utils.writeToFile(s, filePath);
    return true
  }

  


  getArtboardGroups(context) {

    const artboardGroups = [];

    if(null==this.exportOptions || !('mode' in this.exportOptions)){
      this.ndoc.pages().forEach(function(page){
        // skip marked by '*'
        if(page.name().indexOf("*")==0){
          return
        }
        log('name='+page.name())
 
        let artBoards = MyArtboard.getArtboardGroupsInPage(page, context, false)
        if(!artBoards.length) return
        
        if(Constants.SORT_RULE_X == this.sortRule){
          artBoards.sort((
            function(a, b){
              return a[0].artboard.absoluteRect().x()-b[0].artboard.absoluteRect().x()
          }))
        }else  if(Constants.SORT_RULE_REVERSIVE_SKETCH == this.sortRule){
          artBoards = artBoards.reverse()
        }else{
        }

        artboardGroups.push.apply(artboardGroups,artBoards);
      },this)
    }else if (this.exportOptions.mode==Constants.EXPORT_MODE_CURRENT_PAGE){      
      artboardGroups.push.apply(artboardGroups, MyArtboard.getArtboardGroupsInPage(this.exportOptions.currentPage, context, false));
    }else if (this.exportOptions.mode==Constants.EXPORT_MODE_SELECTED_ARTBOARDS){
      const list = []
      for (var i = 0; i < this.exportOptions.selectedArtboards.length; i++) {
        list.push(this.exportOptions.selectedArtboards[i].sketchObject)        
      }
      artboardGroups.push.apply(artboardGroups,Utils.getArtboardGroups(list, context))  
    }else{
      log('ERROR: unknown export mode: '.this.exportOptions.mode)
    }

    // try to find flowStartPoint and move it on top  
    for (var i = 0; i < artboardGroups.length; i++) {
      const a = artboardGroups[i][0].artboard;
      if( a.isFlowHome() ){
         if(i!=0){              
              // move found artgroup to the top
              const item1 = artboardGroups[i];
              artboardGroups.splice(i,1);
              artboardGroups.splice(0,0,item1);
          }
          break;
      }
    }  

    return artboardGroups;
  }


  filterArtboards(){
    const filtered = []
    for(var artboard of this.myLayers){
      // Skip artboards with external URL enabled
      if(artboard.externalArtboardURL!=undefined) continue
      artboard.pageIndex = filtered.length
      filtered.push(artboard)      
    }
    this.myLayers = filtered
  }


  
  compressImages(){
    if(!this.exportOptions.compress) return true
    
    log(" compressImages: running...")
    const pub = new Publisher(this.context,this.ndoc);    
    pub.copyScript("compress2.sh")
    var url = pub.context.plugin.urlForResourceNamed('advpng').path()
    const res = pub.runScriptWithArgs("compress2.sh",[this.imagesPath,url])
    if(!res.result){        
        log(" compressImages: failed!")
    }else
        log(" compressImages: done!")

    pub.showOutput(res) 
  }

  buildPreviews(){
    log(" buildPreviews: running...")
    const pub = new Publisher(this.context,this.ndoc);    

    for(var file of this.exportedImages){
       //log(" buildPreviews: "+file)
        var fileName = this.imagesPath + "/" + file

        let args = ["-Z","300",fileName,"--out",this.imagesPath+"previews/"]
        let res = pub.runToolWithArgs("/usr/bin/sips", args)

        if(!res.result){
            pub.showOutput(res)    
            break
        }
    }

    log(" buildPreviews: done!!!!!")
  }

  createViewerFile(fileName){
    return this.prepareFilePath(this._outputPath + "/" + Constants.VIEWER_DIRECTORY,fileName);
  }

  generateJSStoryEnd(){
    const iFrameSizeSrc = this.Settings.settingForKey(SettingKeys.PLUGIN_SHARE_IFRAME_SIZE)    
    let iFrameSize = undefined
    if(iFrameSizeSrc!=undefined && iFrameSizeSrc!=''){
        const size = iFrameSizeSrc.split(':')
        if(2==size.length){
            iFrameSize = {
                width: size[0],
                height: size[1]
            }
        }
    }

    this.jsStory += 
     '   ]\n,'+
     '"resolutions": ['+(this.retinaImages?'2':'1')+'],\n'+
     '"zoomEnabled": '+ (this.Settings.settingForKey(SettingKeys.PLUGIN_DISABLE_ZOOM)!=1?'true':'false')+',\n'+
     '"title": "'+this.docName+'",\n'+
     '"startPageIndex": '+this.mDoc.startArtboardIndex+',\n'+
     '"layersExist": ' + ( this.enabledJSON ? "true":"false") +',\n'+
     '"centerContent":  '+(this.Settings.settingForKey(SettingKeys.PLUGIN_POSITION) === Constants.POSITION_CENTER) +',\n'+
     '"totalImages": '+pzDoc.totalImages+',\n'+
     '"highlightLinks": false\n'
    if(undefined!=iFrameSize){
        this.jsStory += ',"iFrameSizeWidth": "'+iFrameSize.width+'"\n'
        this.jsStory += ',"iFrameSizeHeight": "'+iFrameSize.height+'"\n'
    }
     this.jsStory += 
    '}\n';

    const pathStoryJS = this.createViewerFile('story.js')
    if(undefined==pathStoryJS) return false

    Utils.writeToFile(this.jsStory, pathStoryJS)
    return true
  }



  exportArtboards() {        
    log("exportArtboards: running...")    

    // Copy static files
    if(!this.copyStatic("resources")) return false    
    if(!this.copyStatic("viewer")) return false

    this.mDoc = new PZDoc()
    try {
        // Collect layers information
        this.mDoc.collectData()
        this.mDoc.buildLinks()
        

        // Build main HTML file
        if(!this.createMainHTML()) return false
        
        // Build Story.js with hotspots  
        this.generateJSStoryBegin();
        let index = 0;

        // Export every artboard into PNG image
        this.mDoc.export()
        
        if(!this.generateJSStoryEnd()) return false
    
        // Compress Images
        this.compressImages()

        // Build image small previews for Gallery
        this.buildPreviews()

        // Save site icon
        if(this.siteIconLayer!=undefined){        
            this.siteIconLayer.exportSiteIcon()
        }

        // Dump document layers to JSON file
        this.saveToJSON()
    }
    catch(error) {
        this.logError(error)
    }    
    finally{
        this.mDoc.undoChanges()

    }

    log("exportArtboards: done!")

    return true
  }  

    saveToJSON(){
        if( !this.enabledJSON ) return true

        const symbolData = this.mDoc.getSymbolData()
        const json = this.mDoc.getJSON()

        const pathJSFile = this.createViewerFile('LayersData.js')
        return Utils.writeToFile(symbolData+"var layersData = "+json, pathJSFile)
    }


  prepareOutputFolder(selectedPath) {
    let error;
    const fileManager = NSFileManager.defaultManager();

    this._outputPath = selectedPath + "/" + this.docName
  

    if (fileManager.fileExistsAtPath(this._outputPath)) {
      error = MOPointer.alloc().init();
      if(!fileManager.removeItemAtPath_error(this._outputPath,error)){
         log(error.value().localizedDescription());
      }
    }
    error = MOPointer.alloc().init();
    if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(this._outputPath, false, null, error)) {
        log(error.value().localizedDescription());
    }

    this.imagesPath = this._outputPath + "/" + Constants.IMAGES_DIRECTORY;
    const previewPath =  this.imagesPath + "previews/"    
    if (!fileManager.fileExistsAtPath(previewPath)) {
        error = MOPointer.alloc().init();
        log(previewPath)
        if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(previewPath, true, null, error)) {
            log(error.value().localizedDescription());
        }
    } else {
        Utils.removeFilesWithExtension(this.imagesPath, "png");
    }
  }
}