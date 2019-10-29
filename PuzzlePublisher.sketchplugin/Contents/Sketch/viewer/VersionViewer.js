function getVersionInfoRequest() {
    var resp = this
    if (resp.readyState == resp.DONE) {
        if (resp.status == 200 && resp.responseText != null) {
            const data = JSON.parse(resp.responseText)
            if (undefined != data['time']) {
                viewer.versionViewer._loadData(data);
                return true
            }
        }
        showError("Can't get information about the versions.")
    }
    return false
}


class VersionViewer {
    constructor() {
        this.visible = false
        this.inited = false
        this.screenDiffs = []
    }

    initialize(force = false) {
        if (!force && this.inited) return

        // init document common data here
        this._showLoadingMessage()
        this._askServerTools();

        this.inited = true
    }

    toggle() {
        return this.visible ? this.hide() : this.show()
    }

    hideSelfOnly() {
        this.visible = false
        $('#version_viewer').addClass("hidden")
    }

    hide() {
        viewer.hideSidebar();
    }

    goTo(pageIndex) {
        viewer.goToPage(pageIndex)
    }

    // called by Viewer
    pageChanged() {

        var disabled = !this.screenDiffs[viewer.currentPage.getHash()]

        $("#version_viewer_mode_diff").prop('disabled', disabled);
        $("#version_viewer_mode_new").prop('disabled', disabled);
        $("#version_viewer_mode_prev").prop('disabled', disabled);
        if (disabled) return

        this._showCurrentPageDiffs()
    }

    _showScreens(data, showNew) {
        var info = "";
        for (const screen of data['screens_changed']) {
            if (screen['is_new'] != showNew) continue;
            const pageIndex = viewer.getPageIndex(screen['screen_name'], -1)
            var pageName = pageIndex >= 0 ? story.pages[pageIndex].title : screen['screen_name'];

            if (pageIndex >= 0 && screen['is_diff']) {
                this.screenDiffs[screen['screen_name']] = screen
            }

            info += "<div class='version-screen-div' onclick='viewer.versionViewer.goTo(" + pageIndex + ")'>";
            info += "<div>";
            info += pageName;
            info += "</div><div>";
            info += "<img src='" + screen['image_url'] + "' border='0'/>";
            info += "</div>";
            info += "</div>";
        }
        return info;
    }

    _showCurrentPageDiffs() {
        const data = this.data
        const page = viewer.currentPage
        if (!page || !data) return false

        const screen = this.screenDiffs[page.getHash()]
        if (!screen) return false

        var mode = $("#version_viewer_mode_diff").prop('checked') ? 'diff' : ($("#version_viewer_mode_prev").prop('checked') ? 'prev' : 'new')
        var newSrc = ''

        // save original image srcs
        if (!page.srcImageObjSrc) page.srcImageObjSrc = page.imageObj.attr("src")

        if ('diff' == mode) {
            newSrc = data['journals_path'] + '/' + data['dir'] + "/diffs/" + screen['screen_name'] + (story.hasRetina && viewer.isHighDensityDisplay() ? "@2x" : "") + ".png"
        } else if ('new' == mode) {
            if (page.imageObj.attr("src") != page.srcImageObjSrc) {
                newSrc = page.srcImageObjSrc
            }
        } else {
            newSrc = "../" + data['down_ver'] + "/" + page.srcImageObjSrc
        }


        page.imageObj.attr("src", newSrc)
        return true
    }

    _loadData(data) {
        var info = ""
        this.data = data
        this.screenDiffs = {}

        if (data['screens_total_new']) {
            info += "<p class='head'>Added screens (" + data['screens_total_new'] + "):</p>";
            info += this._showScreens(data, true);
        }
        if (data['screens_total_changed']) {
            info += "<p class='head'>Changed screens (" + data['screens_total_changed'] + ")</p>";
            info += this._showScreens(data, false);
        }
        if (!data['screens_total_new'] && !data['screens_total_changed']) {
            info += "No new or changed screens"
        }

        this._showCurrentPageDiffs()

        $("#version_viewer_content").html(info)
    }

    _askServerTools() {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = getVersionInfoRequest;
        xhr.open("GET", story.serverToolsPath + "version_info.php?ver=" + story.docVersion, true);
        xhr.send(null);
    }

    show() {
        viewer.hideSidebarChild();

        if (!this.inited) this.initialize()

        $('#version_viewer').removeClass("hidden")
        viewer.showSidebar(this)
        this.visible = true
    }

    _showLoadingMessage() {
        $("#version_viewer_content").html("Loading...")
        $('#version_viewer #empty').removeClass("hidden")
    }
}
