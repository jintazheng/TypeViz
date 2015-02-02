
/// <reference path="Globals.ts" />
/// <reference path="Extensions.ts" />
/// <reference path="Maths.ts" />
///<reference path='Model.ts' />
///<reference path='Animation.ts' />
///<reference path='SVG.ts' />
///<reference path='Arrays.ts' />
///<reference path='Structures.ts' />



module TypeViz {

    /*A whole universe of diagramming and graph layout.*/
    export module Diagramming {

        import SVG = TypeViz.SVG;
        import Group = TypeViz.SVG.Group;
        import Canvas = TypeViz.SVG.Canvas;
        import Point = TypeViz.Point;
        import Rect = TypeViz.Rect;
        import Marker = TypeViz.SVG.Marker;
        import Visual = TypeViz.SVG.Visual;
        import PathBase = TypeViz.SVG.PathBase;
        import NS = TypeViz.SVG.NS;

        /*Graph layout undoredo unit */
        export class LayoutUndoUnit implements IUndoUnit {
            private animate;
            private initialState;
            private _finalState;
            public Title: string;
            public IsEmpty: boolean;
            constructor(initialState, finalState, animate) {
                if (TypeViz.IsUndefined(animate)) {
                    this.animate = false;
                }
                else {
                    this.animate = animate;
                }
                this.initialState = initialState;
                this._finalState = finalState;
                this.Title = "Diagram layout";
            }
            Undo() {
                this.setState(this.initialState);
            }
            Redo() {
                this.setState(this._finalState);
            }
            setState(state) {
                var diagram = state.diagram;
                if (this.animate) {
                    //todo: have a look at connection points  
                    state.linkMap.ForEach(
                        function (id, points) {
                            var conn = diagram.getId(id);
                            conn.visible(false);
                            if (conn) {
                                conn.Points = points;
                            }
                        }
                        );
                    var ticker = new TypeViz.Animation.Ticker();
                    ticker.AddAdapter(new TypeViz.Diagramming.NodePositionAdapter(state));
                    ticker.onComplete(function () {
                        state.linkMap.ForEach(
                            function (id) {
                                var conn = diagram.getId(id);
                                conn.IsVisible = true;
                            }
                            );
                    });
                    ticker.play();
                }
                else {
                    state.nodeMap.ForEach(function (id, bounds) {
                        var shape = diagram.getId(id);
                        if (shape) {
                            shape.Rectangle = bounds;
                        }
                    });
                    /*
                      todo: connection points  */
                    state.linkMap.ForEach(
                        function (id, points) {
                            var conn = diagram.getId(id);
                            if (conn) {
                                var ps = [];
                                // todo: bad point format internal in layout
                                for (var i = 0; i < points.length; i++) {
                                    ps.push(new Point(points[i].x, points[i].y));
                                }
                                conn.Points = ps;
                            }
                        }
                        );
                }

                /*for (var i = 0; i < graph.links.length; i++) {
                 var link = graph.links[i];
                 var p = []
                 if (link.points != null) {
                 p.addRange(link.points);
                 }
                 */
                /* var sb = link.source.associatedShape.bounds();
                 p.prepend(new diagram.Point(sb.x, sb.y));
                 var eb = link.target.associatedShape.bounds();
                 p.append(new diagram.Point(eb.x, eb.y));*/
                /*

                 link.associatedConnection.points(p);
                 }*/

            }
        }

        /**
         * The actual diagramming surface.
         */
        export class DiagramSurface {
            /**
             * The hosting DIV element.
             */
            private div: HTMLDivElement;

            /**
             * The root SVG canvas.
             */
            private canvas: Canvas;
            private mainLayer: Group;
            private theme: ITheme;
            private currentPosition: Point = new TypeViz.Point(0, 0);
            private isShiftPressed: boolean = false;
            private pan = Point.Empty;
            private isPanning = false;
            private panStart: Point;
            private panDelta: Point;
            private panOffset: Point;
            private zoomRate = 1.1;  // Increase for faster zooming (i.e., less granularity).
            private undoRedoService: UndoRedoService = new UndoRedoService();
            /**
             * The collection of items contained within this diagram.
             */
            public shapes: Shape[] = [];
            public connections: Connection[] = [];
            private lastUsedShapeTemplate: IShapeTemplate = null;
            private hoveredItem: IFrameworkElement = null;
            private newItem: Shape = null;
            private newConnection: Connection = null;
            private selector: Selector = null;
            private isManipulating: boolean = false;
            private keyCodeTable: any;
            private isFirefox: boolean;
            private isSafari: boolean;
            private currentZoom = 1.0;
            private isLayouting = false;
            private MouseDownHandler: (e: MouseEvent) => void;
            private MouseUpHandler: (e: MouseEvent) => void;
            private MouseMoveHandler: (e: MouseEvent) => void;
            private _doubleClickHandler: (e: MouseEvent) => void;
            private _touchStartHandler: (e: TouchEvent) => void;
            private _touchEndHandler: (e: TouchEvent) => void;
            private _touchMoveHandler: (e: TouchEvent) => void;
            private KeyDownHandler: (e: KeyboardEvent) => void;
            private KeyPressHandler: (e: KeyboardEvent) => void;
            private KeyUpHandler: (e: KeyboardEvent) => void;

            /*Applies a graph layout algorithm to organize it.*/
            public Layout(settings: Diagramming.LayoutSettings= null) {
                this.isLayouting = true;
                // TODO: raise layout event?

                if (TypeViz.IsUndefined(settings)) {
                    settings = new Diagramming.LayoutSettings();
                }
                if (TypeViz.IsUndefined(settings.Type)) {
                    settings.Type = TypeViz.Diagramming.LayoutTypes.ForceDirectedLayout;
                }
                var l;
                switch (settings.Type) {
                    case TypeViz.Diagramming.LayoutTypes.TreeLayout:
                        l = new TypeViz.Diagramming.TreeLayout(this);
                        break;

                    case TypeViz.Diagramming.LayoutTypes.LayeredLayout:
                        l = new TypeViz.Diagramming.LayeredLayout(this);
                        break;

                    case TypeViz.Diagramming.LayoutTypes.ForceDirectedLayout:
                        l = new TypeViz.Diagramming.SpringLayout(this);
                        break;
                    default:
                        throw "Layout algorithm '" + settings.Type + "' is not supported.";
                }
                var initialState = new TypeViz.Diagramming.LayoutState(this);
                var finalState = l.Layout(settings);
                if (finalState) {
                    var unit = new TypeViz.Diagramming.LayoutUndoUnit(initialState, finalState, settings.Animate ? settings.Animate : null);
                    this.undoRedoService.Add(unit);
                }
                this.isLayouting = false;
            }

            /**
           * Generates a random diagram.
           * @param shapeCount The number of shapes the random diagram should contain.
           * @param maxIncidence The maximum degree the shapes can have.
           * @param isTree Whether the generated diagram should be a tree
           * @param layoutType The optional layout type to apply after the diagram is generated.
           */
            randomDiagram(shapeCount, maxIncidence?, isTree?, randomSize?) {
                var g = TypeViz.Diagramming.Graph.Utils.createRandomConnectedGraph(shapeCount, maxIncidence, isTree);
                TypeViz.Diagramming.Graph.Utils.createDiagramFromGraph(this, g, false, randomSize);
            }
            /**
             * The collection of items contained within this diagram.
             */
            public get Shapes() {
                return this.shapes;
            }

            public get Connections() {
                return this.connections;
            }

            //TODO: note to Swa: ensure you delete this after the importer is working!!
            public get Canvas() {
                return this.canvas;
            }

            public get Zoom() { return this.currentZoom; }
            public set Zoom(v: number) {
                if (this.mainLayer == null) throw "The 'mainLayer' is not present.";
                //around 0.5 something exponential happens...!?
                this.currentZoom = Math.min(Math.max(v, 0.55), 2.0);

                this.mainLayer.Native.setAttribute("transform", "translate(" + this.pan.X + "," + this.pan.Y + ")scale(" + this.currentZoom + "," + this.currentZoom + ")");
            }
            public get Pan() {
                return this.pan;
            }
            public set Pan(v: Point) {
                this.pan = v;
                this.mainLayer.Native.setAttribute("transform", "translate(" + this.pan.X + "," + this.pan.Y + ")scale(" + this.currentZoom + "," + this.currentZoom + ")");
            }
            public get MainLayer() {
                return this.mainLayer;
            }
            public get Element() {
                return this.div;
            }
            constructor(div: HTMLDivElement) {
                // the hosting div element
                this.div = div;

                // the root SVG Canvas
                this.canvas = new SVG.Canvas(div);
                this.canvas.Width = div.clientWidth;
                this.canvas.Height = div.clientHeight;
                // the main layer
                this.mainLayer = new SVG.Group();
                this.mainLayer.Id = "mainLayer";

                this.canvas.Append(this.mainLayer);
                // the default theme
                this.theme = {
                    background: "#fff",
                    connection: "#000",
                    selection: "#ff8822",
                    connector: "#31456b",
                    connectorBorder: "#fff",
                    connectorHoverBorder: "#000",
                    connectorHover: "#0c0"
                };
                // some switches 
                this.isSafari = typeof navigator.userAgent.split("WebKit/")[1] != "undefined";
                this.isFirefox = navigator.appVersion.indexOf('Gecko/') >= 0 || ((navigator.userAgent.indexOf("Gecko") >= 0) && !this.isSafari && (typeof navigator.appVersion != "undefined"));

                this.MouseDownHandler = (e: MouseEvent) => {
                    this.MouseDown(e);
                };
                this.MouseUpHandler = (e: MouseEvent) => {
                    this.MouseUp(e);
                };
                this.MouseMoveHandler = (e: MouseEvent) => {
                    this.MouseMove(e);
                };
                this._doubleClickHandler = (e: MouseEvent) => {
                    this.doubleClick(e);
                };
                this._touchStartHandler = (e: TouchEvent) => {
                    this.touchStart(e);
                }
            this._touchEndHandler = (e: TouchEvent) => {
                    this.touchEnd(e);
                }
            this._touchMoveHandler = (e: TouchEvent) => {
                    this.touchMove(e);
                }
            this.KeyDownHandler = (e: KeyboardEvent) => {
                    this.KeyDown(e);
                }
            this.KeyPressHandler = (e: KeyboardEvent) => {
                    this.KeyPress(e);
                }
            this.KeyUpHandler = (e: KeyboardEvent) => {
                    this.keyUp(e);
                }

            this.canvas.MouseMove(this.MouseMoveHandler);
                this.canvas.MouseDown(this.MouseDownHandler);
                this.canvas.MouseUp(this.MouseUpHandler);
                this.canvas.KeyDown = this.KeyDownHandler;
                this.canvas.KeyPress = this.KeyPressHandler;
                //this.todelete.addEventListener("touchstart", this._touchStartHandler, false);
                //this.todelete.addEventListener("touchend", this._touchEndHandler, false);
                //this.todelete.addEventListener("touchmove", this._touchMoveHandler, false);
                //this.todelete.addEventListener("dblclick", this._doubleClickHandler, false);
                //this.todelete.addEventListener("keydown", this.KeyDownHandler, false);
                //this.todelete.addEventListener("KeyPress", this.KeyPressHandler, false);
                //this.todelete.addEventListener("keyup", this.KeyUpHandler, false);
                this.selector = new Selector(this);
                this.listToWheel(this);
            }
            private listToWheel(self) {
                var mousewheelevt = (/Firefox/i.test(navigator.userAgent)) ? "DOMMouseScroll" : "mousewheel" //FF doesn't recognize mousewheel as of FF3.x
            var handler = e => {
                    var evt = window.event || e;
                    if (evt.preventDefault) evt.preventDefault();
                    else evt.returnValue = false;

                    self.zoomViaMouseWheel(evt, self);
                    return;
                };
                if (self.div.attachEvent) //if IE (and Opera depending on user setting)
                    self.div.attachEvent("on" + mousewheelevt, handler)
            else if (self.div.addEventListener) //WC3 browsers
                    self.div.addEventListener(mousewheelevt, handler, false)
        }
            private zoomViaMouseWheel(mouseWheelEvent, diagram) {
                var evt = window.event || mouseWheelEvent;
                var delta = evt.detail ? evt.detail * (-120) : evt.wheelDelta
            var z = diagram.Zoom;;
                if (delta > 0)
                    z *= this.zoomRate;
                else
                    z /= this.zoomRate;

                diagram.Zoom = z;
                /* When the mouse is over the webpage, don't let the mouse wheel scroll the entire webpage: */
                mouseWheelEvent.cancelBubble = true;
                return false;
            }

            public Focus() {
                this.canvas.Focus();
            }

            public get Theme(): ITheme {
                return this.theme;
            }

            public Delete(undoable: boolean = false) {
                this.DeleteCurrentSelection(undoable);
                this.Refresh();
                this.UpdateHoveredItem(this.currentPosition);
                this.UpdateCursor();
            }

            public get Selection(): IDiagramItem[] {
                return this.getCurrentSelection();
            }

            /**
                 * Clears the current diagram and the undo-redo stack.
                 */
            public Clear() {
                this.currentZoom = 1.0;
                this.pan = Point.Empty;
                this.shapes = [];
                this.connections = [];
                this.canvas.Clear();
                this.mainLayer = new SVG.Group();
                this.mainLayer.Id = "mainLayer";
                this.canvas.Append(this.mainLayer);
                this.undoRedoService = new UndoRedoService();
            }

            private getCurrentSelection(): IDiagramItem[] {
                var selection: IDiagramItem[] = [];
                for (var i = 0; i < this.shapes.length; i++) {
                    var shape = this.shapes[i];
                    if (shape.IsSelected) selection.push(shape);

                    for (var j = 0; j < shape.Connectors.length; j++) {
                        var connector = shape.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) {
                            var connection: Connection = connector.Connections[k];
                            if (connection.IsSelected) selection.push(connection);
                        }
                    }
                }
                return selection;
            }

            public set Theme(value: ITheme) {
                this.theme = value;
            }

            public get elements(): Shape[] {
                return this.shapes;
            }
            /**
             * Adds the given connection to the diagram.
             * @param con The connection to add.
             */
            public AddConnection(con: Connection): Connection;

            /**
             * Creates a connection between the given connectors.
             * @param from The connector where the connection starts.
             * @param to The connector where the connection ends.
             */
            public AddConnection(from: Connector, to: Connector): Connection;
            public AddConnection(from: Shape, to: Shape): Connection;

            /**
             * Creates a connection between the given connectors.
             */
            public AddConnection(item: any, sink?: any): Connection {
                var connection: Connection = null;
                var source: Connector = null;

                if (item instanceof Connection) {
                    if (sink != null) throw "Connection and sink cannot be specified simultaneously.";
                    connection = <Connection>item;
                    source = connection.From;
                    sink = connection.To;
                }
                else {
                    if (item instanceof Connector) {
                        source = <Connector>item;
                        connection = new Connection(source, sink);
                    }
                    else if (item instanceof Shape && TypeViz.IsDefined(sink) && sink instanceof Shape) {
                        source = (<Shape>item).Connectors[0];
                        sink = (<Shape>sink).Connectors[0];
                        connection = new Connection(source, sink);
                    }
                    else throw "AddConnection with unsupported parameter combination.";
                }

                source.Connections.push(connection);

                if (sink != null) // happens when drawing a new connection
                {
                    sink.Connections.push(connection);
                }
                this.mainLayer.Prepend(connection.Visual);
                connection.Diagram = this;
                connection.Invalidate();
                this.connections.push(connection);
                return connection;
            }
            public getId(id) {
                var found;
                found = this.shapes.First(function (s) {
                    return s.Visual.Native.id === id;
                });
                if (found) {
                    return found;
                }
                found = this.connections.First(function (c) {
                    return c.Visual.Native.id === id;
                });
                return found;
            }

            public AddShape();
            public AddShape(template: IShapeTemplate);
            public AddShape(input1?, input2?): Shape {
                var template, position;
                if (TypeViz.IsUndefined(input1)) {
                    input1 = new TypeViz.Point(0, 0);
                }
                if (input1 instanceof TypeViz.Point) {
                    if (TypeViz.IsDefined(input2)) {
                        template = input2;
                        position = template.hasOwnProperty("position") ? template["position"] : new Point(0, 0);
                    }
                    else {
                        template = TypeViz.Diagramming.Shapes.Rectangle;
                        position = input1;
                    }
                    this.lastUsedShapeTemplate = template;
                    var item = new Shape(template, position);
                    var options = input2 || {};
                    if (options.id) item.Visual.Native.id = options.id;
                    return this.AddItem(item);
                }
                else {
                    template = <IShapeTemplate>input1;
                    if (!template) throw "Expecting a Point or IShapeTemplate";
                    this.lastUsedShapeTemplate = template;
                    var item = new Shape(template, template.Position);
                    this.AddItem(item);
                    return item;
                }
            }

            public AddItem(shape: Shape) {
                this.shapes.push(shape);
                shape.Diagram = this;
                this.mainLayer.Append(shape.Visual);

                return shape;
            }
            public AddMarker(marker: SVG.Marker) {
                this.canvas.AddMarker(marker);
            }

            public Undo() {
                this.undoRedoService.Undo();
                this.Refresh();
                this.UpdateHoveredItem(this.currentPosition);
                this.UpdateCursor();
            }

            public SelectAll() {
                this.undoRedoService.begin();
                var selectionUndoUnit = new SelectionUndoUnit();
                this.selectAll(selectionUndoUnit, null);
                this.undoRedoService.Add(selectionUndoUnit);
                this.Refresh();
                this.UpdateHoveredItem(this.currentPosition);
                this.UpdateCursor();
            }

            public Redo() {
                this.undoRedoService.Redo();
                this.Refresh();
                this.UpdateHoveredItem(this.currentPosition);
                this.UpdateCursor();
            }

            public RecreateLastUsedShape() {
                var shape = new Shape(this.lastUsedShapeTemplate, this.currentPosition);
                var unit = new AddShapeUnit(shape, this);
                this.undoRedoService.Add(unit);
            }

            /**
             * Removes the given connection from the diagram.
             */
            public RemoveConnection(con: Connection) {
                con.IsSelected = false;
                con.From.Connections.Remove(con);
                if (con.To != null) con.To.Connections.Remove(con);
                con.Diagram = null;
                this.Connections.Remove(con);
                this.mainLayer.Remove(con.Visual);
            }

            public RemoveShape(shape: Shape) {
                shape.Diagram = null;
                shape.IsSelected = false;
                this.shapes.Remove(shape);
                this.mainLayer.Remove(shape.Visual);
            }

            public setElementContent(element: Shape, content: any) {
                this.undoRedoService.Add(new ContentChangedUndoUnit(element, content));
                this.Refresh();
            }

            public DeleteCurrentSelection(undoable: boolean = true) {
                if (undoable) this.undoRedoService.begin();

                var deletedConnections: Connection[] = [];
                for (var i = 0; i < this.shapes.length; i++) {
                    var shape = this.shapes[i];
                    for (var j = 0; j < shape.Connectors.length; j++) {
                        var connector = shape.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) {
                            var connection = connector.Connections[k];
                            if ((shape.IsSelected || connection.IsSelected) && (!deletedConnections.Contains(connection))) {
                                if (undoable) this.undoRedoService.AddCompositeItem(new DeleteConnectionUnit(connection));
                                deletedConnections.push(connection);
                            }
                        }
                    }
                }
                //if not undoable; cannot alter the collection or the loop will be biased
                if (!undoable && deletedConnections.length > 0) {
                    for (var i = 0; i < deletedConnections.length; i++) {
                        var connection = deletedConnections[i];
                        this.RemoveConnection(connection);
                    }
                }

                for (var i = 0; i < this.shapes.length; i++) {
                    var shape: Shape = this.shapes[i];
                    if (shape.IsSelected) {
                        if (undoable) this.undoRedoService.AddCompositeItem(new DeleteShapeUnit(shape));
                        else this.RemoveShape(shape);
                    }
                }
                if (undoable) this.undoRedoService.commit();
            }

            /**
             * The mouse down logic.
             */
            private MouseDown(e: MouseEvent) {
                this.Focus();
                e.preventDefault();
                this.UpdateCurrentPosition(e);
                if (e.button === 0) {
                    // alt+click allows fast creation of element using the active template
                    if ((this.newItem === null) && (e.altKey)) this.RecreateLastUsedShape();
                    else this.Down(e);
                }
            }

            /**
             * The mouse up logic.
             */
            private MouseUp(e: MouseEvent) {
                e.preventDefault();
                this.UpdateCurrentPosition(e);
                if (e.button === 0) this.Up();
            }

            /**
             * The mouse MoveTo logic.
             */
            private MouseMove(e: MouseEvent) {
                e.preventDefault();
                this.UpdateCurrentPosition(e);
                this.Move();
            }

            private doubleClick(e: MouseEvent) {
                e.preventDefault();
                this.UpdateCurrentPosition(e);

                if (e.button === 0) // left-click
                {
                    var point: Point = this.currentPosition;

                    this.UpdateHoveredItem(point);
                    if ((this.hoveredItem != null) && (this.hoveredItem instanceof Shape)) {
                        var item = <Shape> this.hoveredItem;
                        if ((item.Template != null) && ("edit" in item.Template)) {
                            item.Template.Edit(item, this.canvas, point);
                            this.Refresh();
                        }
                    }
                }
            }

            private touchStart(e: TouchEvent) {
                if (e.touches.length == 1) {
                    e.preventDefault();
                    this.UpdateCurrentTouchPosition(e);
                    this.Down(e);
                }
            }

            private touchEnd(e: TouchEvent) {
                e.preventDefault();
                this.Up();
            }

            private touchMove(e: TouchEvent) {
                if (e.touches.length == 1) {
                    e.preventDefault();
                    this.UpdateCurrentTouchPosition(e);
                    this.Move();
                }
            }

            /**
             * The actual mouse down logic.
             */
            private Down(e) {
                var p = this.currentPosition;

                if (this.newItem != null) {
                    this.undoRedoService.begin();

                    this.newItem.Rectangle = new Rect(p.X, p.Y, this.newItem.Rectangle.Width, this.newItem.Rectangle.Height);
                    this.newItem.Invalidate();
                    this.undoRedoService.AddCompositeItem(new AddShapeUnit(this.newItem, this));
                    this.undoRedoService.commit();
                    this.newItem = null;
                }
                else {
                    this.selector.End();
                    this.UpdateHoveredItem(p);
                    if (this.hoveredItem === null) {
                        var ev = window.event || e;
                        if (ev.ctrlKey == true) {
                            //pan
                            this.isPanning = true;
                            this.panStart = this.Pan;
                            this.panOffset = p;// new Point(p.X - this.panStart.X, p.Y + this.panStart.Y);
                            this.panDelta = Point.Empty;//relative to root
                        }
                        else {
                            // Start selection
                            this.selector.Start(p);
                        }

                    }
                    else {
                        // Start connection
                        if ((this.hoveredItem instanceof Connector) && (!this.isShiftPressed)) {
                            var connector = <Connector> this.hoveredItem;
                            //console.log("Starting a new connection from " + connector.Template.Name);
                            if (connector.CanConnectTo(null)) {
                                this.newConnection = this.AddConnection(connector, null);
                                this.newConnection.UpdateEndPoint(p);
                            }
                        }
                        else {
                            // select object
                            var item: IDiagramItem = <IDiagramItem> this.hoveredItem;
                            if (!item.IsSelected) {
                                this.undoRedoService.begin();
                                var selectionUndoUnit: SelectionUndoUnit = new SelectionUndoUnit();
                                if (!this.isShiftPressed) this.DeselectAll(selectionUndoUnit);
                                selectionUndoUnit.select(item);
                                this.undoRedoService.AddCompositeItem(selectionUndoUnit);
                                this.undoRedoService.commit();
                            }
                            else if (this.isShiftPressed) {
                                this.undoRedoService.begin();
                                var deselectUndoUnit: SelectionUndoUnit = new SelectionUndoUnit();
                                deselectUndoUnit.deselect(item);
                                this.undoRedoService.AddCompositeItem(deselectUndoUnit);
                                this.undoRedoService.commit();
                            }

                            // seems we are transforming things
                            var hit = new Point(0, 0);
                            if (this.hoveredItem instanceof Shape) {
                                var element: Shape = <Shape> this.hoveredItem;
                                hit = element.Adorner.HitTest(p);
                            }
                            for (var i = 0; i < this.shapes.length; i++) {
                                var shape = this.shapes[i];
                                if (shape.Adorner != null) shape.Adorner.Start(p, hit);
                            }
                            this.isManipulating = true;
                        }
                    }
                }

                this.Refresh();
                this.UpdateCursor();
            }

            /**
             * The actual mouse MoveTo logic.
             */
            private Move() {
                var p = this.currentPosition;

                if (this.newItem != null) {
                    // placing new element
                    this.newItem.Rectangle = new Rect(p.X, p.Y, this.newItem.Rectangle.Width, this.newItem.Rectangle.Height);
                    this.newItem.Invalidate();
                }
                if (this.isPanning) {
                    this.panDelta = new Point(this.panDelta.X + p.X - this.panOffset.X, this.panDelta.Y + p.Y - this.panOffset.Y);
                    this.Pan = new Point(this.panStart.X + this.panDelta.X, this.panStart.Y + this.panDelta.Y);
                    //this.Canvas.Cursor = Cursors.MoveTo;
                    return;
                }
                if (this.isManipulating) {
                    // moving IsSelected elements
                    for (var i = 0; i < this.shapes.length; i++) {
                        var shape = this.shapes[i];
                        if (shape.Adorner != null) {
                            shape.Adorner.MoveTo(p);
                            // this will also repaint the visual
                            shape.Rectangle = shape.Adorner.Rectangle;
                        }
                    }
                }

                if (this.newConnection != null) {
                    // connecting two connectors               
                    this.newConnection.UpdateEndPoint(p);
                    this.newConnection.Invalidate();
                }

                if (this.selector != null) this.selector.updateCurrentPoint(p);

                this.UpdateHoveredItem(p);
                this.Refresh();
                this.UpdateCursor();
            }

            /**
             * The actual mouse up logic.
             */
            private Up() {
                var point: Point = this.currentPosition;
                if (this.isPanning) {
                    this.isPanning = false;
                    //this.Canvas.Cursor = Cursors.arrow;
                    var unit = new PanUndoUnit(this.panStart, this.Pan, this);
                    this.undoRedoService.Add(unit);
                    return;
                }
                if (this.newConnection != null) {
                    this.UpdateHoveredItem(point);
                    this.newConnection.Invalidate();
                    if ((this.hoveredItem != null) && (this.hoveredItem instanceof Connector)) {
                        var connector = <Connector> this.hoveredItem;
                        if ((connector != this.newConnection.From) && (connector.CanConnectTo(this.newConnection.From))) {
                            this.newConnection.To = connector;
                            this.undoRedoService.Add(new AddConnectionUnit(this.newConnection, this.newConnection.From, connector));
                            console.log("Connection established.");
                        }
                        else
                            this.RemoveConnection(this.newConnection); //remove temp connection
                    }
                    else
                        this.RemoveConnection(this.newConnection);
                    this.newConnection = null;
                }

                if (this.selector.IsActive) {
                    this.undoRedoService.begin();
                    var selectionUndoUnit: SelectionUndoUnit = new SelectionUndoUnit();
                    var rectangle = this.selector.Rectangle;
                    var selectable: IDiagramItem = <IDiagramItem> this.hoveredItem;
                    if (((this.hoveredItem === null) || (!selectable.IsSelected)) && !this.isShiftPressed) this.DeselectAll(selectionUndoUnit);
                    if ((rectangle.Width != 0) || (rectangle.Height != 0)) this.selectAll(selectionUndoUnit, rectangle);
                    this.undoRedoService.AddCompositeItem(selectionUndoUnit);
                    this.undoRedoService.commit();
                    this.selector.End();
                }

                if (this.isManipulating) {
                    this.undoRedoService.begin();
                    for (var i = 0; i < this.shapes.length; i++) {
                        var shape = this.shapes[i];
                        if (shape.Adorner != null) {
                            shape.Adorner.Stop();
                            shape.Invalidate();
                            var r1 = shape.Adorner.InitialState;
                            var r2 = shape.Adorner.FinalState;
                            if ((r1.X != r2.X) || (r1.Y != r2.Y) || (r1.Width != r2.Width) || (r1.Height != r2.Height))
                                this.undoRedoService.AddCompositeItem(new TransformUnit(shape, r1, r2));

                        }
                    }

                    this.undoRedoService.commit();
                    this.isManipulating = false;
                    this.UpdateHoveredItem(point);
                }

                this.Refresh();
                this.UpdateCursor();
            }

            private KeyDown(e: KeyboardEvent) {
                if (!this.isFirefox) this.ProcessKey(e, e.keyCode);
            }

            private KeyPress(e: KeyboardEvent) {
                //if (this.isFirefox)
                {
                    if (typeof this.keyCodeTable === "undefined") {
                        this.keyCodeTable = [];
                        var charCodeTable: any = {
                            32: ' ',
                            48: '0',
                            49: '1',
                            50: '2',
                            51: '3',
                            52: '4',
                            53: '5',
                            54: '6',
                            55: '7',
                            56: '8',
                            57: '9',
                            59: ';',
                            61: '=',
                            65: 'a',
                            66: 'b',
                            67: 'c',
                            68: 'd',
                            69: 'e',
                            70: 'f',
                            71: 'g',
                            72: 'h',
                            73: 'i',
                            74: 'j',
                            75: 'k',
                            76: 'l',
                            77: 'm',
                            78: 'n',
                            79: 'o',
                            80: 'p',
                            81: 'q',
                            82: 'r',
                            83: 's',
                            84: 't',
                            85: 'u',
                            86: 'v',
                            87: 'w',
                            88: 'x',
                            89: 'y',
                            90: 'z',
                            107: '+',
                            109: '-',
                            110: '.',
                            188: ',',
                            190: '.',
                            191: '/',
                            192: '`',
                            219: '[',
                            220: '\\',
                            221: ']',
                            222: '\"'
                        }

                    for (var keyCode in charCodeTable) {
                            var key: string = charCodeTable[keyCode];
                            this.keyCodeTable[key.charCodeAt(0)] = keyCode;
                            if (key.toUpperCase() != key) this.keyCodeTable[key.toUpperCase().charCodeAt(0)] = keyCode;
                        }
                    }

                    this.ProcessKey(e, (this.keyCodeTable[e.charCode] != null) ? this.keyCodeTable[e.charCode] : e.keyCode);
                }
            }

            private keyUp(e: KeyboardEvent) {
                this.UpdateCursor();
            }

            private ProcessKey(e: KeyboardEvent, keyCode: number) {
                if ((e.ctrlKey || e.metaKey) && !e.altKey) // ctrl or option
                {
                    if (keyCode == 65) // A: select all
                    {
                        this.SelectAll();
                        this.stopEvent(e);
                    }

                    if ((keyCode == 90) && (!e.shiftKey)) // Z: undo
                    {
                        this.Undo();
                        this.stopEvent(e);
                    }

                    if (((keyCode == 90) && (e.shiftKey)) || (keyCode == 89)) // Y: redo
                    {
                        this.Redo();
                        this.stopEvent(e);
                    }
                }

                if ((keyCode == 46) || (keyCode == 8)) // del: deletion
                {
                    this.Delete(true)
                this.stopEvent(e);
                }

                if (keyCode == 27) // ESC: stop any action
                {
                    this.newItem = null;
                    if (this.newConnection != null) {
                        this.RemoveConnection(this.newConnection);
                        this.newConnection = null;
                    }
                    this.isManipulating = false;
                    for (var i = 0; i < this.shapes.length; i++) {
                        var element = this.shapes[i];
                        if (element.Adorner != null) element.Adorner.Stop();
                    }

                    this.Refresh();
                    this.UpdateHoveredItem(this.currentPosition);
                    this.UpdateCursor();
                    this.stopEvent(e);
                }
            }

            private stopEvent(e: Event) {
                e.preventDefault();
                e.stopPropagation();
            }

            /**
             * Selects all items of the diagram.
             */
            private selectAll(selectionUndoUnit: SelectionUndoUnit, r: Rect) {
                for (var i = 0; i < this.shapes.length; i++) {
                    var element: Shape = this.shapes[i];
                    if ((r === null) || (element.HitTest(r))) selectionUndoUnit.select(element);
                    for (var j = 0; j < element.Connectors.length; j++) {
                        var connector: Connector = element.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) {
                            var connection: Connection = connector.Connections[k];
                            if ((r === null) || (connection.HitTest(r))) selectionUndoUnit.select(connection);
                        }
                    }
                }
            }

            /**
             * Unselects all items.
             */
            private DeselectAll(selectionUndoUnit: SelectionUndoUnit) {
                for (var i = 0; i < this.shapes.length; i++) {
                    var item = this.shapes[i];
                    selectionUndoUnit.deselect(item);

                    for (var j = 0; j < item.Connectors.length; j++) {
                        var connector: Connector = item.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) selectionUndoUnit.deselect(connector.Connections[k]);
                    }
                }
            }

            /**
             * Refreshed the current hovered item given the current location of the cursor.
             */
            private UpdateHoveredItem(p: Point) {
                var hitObject = this.HitTest(p);
                if (hitObject != this.hoveredItem) {
                    if (this.hoveredItem != null) this.hoveredItem.IsHovered = false;
                    this.hoveredItem = hitObject;
                    if (this.hoveredItem != null) this.hoveredItem.IsHovered = true;
                }
                //if (this.hoveredItem != null)
                //    console.log("hoveredItem:" + this.hoveredItem.toString());
            }

            /**
             * Detects the item underneath the given location.
             */
            private HitTest(point: Point): IFrameworkElement {
                var rectangle = new Rect(point.X, point.Y, 0, 0);

                // connectors
                for (var i = 0; i < this.shapes.length; i++) {
                    var item: Shape = this.shapes[i];
                    for (var j = 0; j < item.Connectors.length; j++) {
                        var connector = item.Connectors[j];
                        if (connector.HitTest(rectangle)) return connector;
                    }
                }

                // shapes
                for (var i = 0; i < this.shapes.length; i++) {
                    var item: Shape = this.shapes[i];
                    if (item.HitTest(rectangle)) return item;
                }

                // connections
                for (var i = 0; i < this.shapes.length; i++) {
                    var item: Shape = this.shapes[i];
                    for (var j: number = 0; j < item.Connectors.length; j++) {
                        var connector: Connector = item.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) {
                            var connection: Connection = connector.Connections[k];
                            if (connection.HitTest(rectangle)) return connection;
                        }
                    }
                }
                return null;
            }

            /**
             * Sets the cursors in function of the currently hovered item.
             */
            private UpdateCursor() {
                /*  if (this.newConnection != null) {
                      this.canvas.Cursor = ((this.hoveredItem != null) && (this.hoveredItem instanceof Connector)) ? this.hoveredItem.GetCursor(this.currentPosition) : Cursors.cross;
                  }
                  else {
                      this.canvas.Cursor = (this.hoveredItem != null) ? this.hoveredItem.GetCursor(this.currentPosition) : Cursors.arrow;
                  }*/
            }

            /*
             * Update the current position of the mouse to the local coordinate system.
             */
            private UpdateCurrentPosition(e: MouseEvent) {
                this.isShiftPressed = e.shiftKey;
                this.currentPosition = new Point(e.pageX - this.pan.X, e.pageY - this.pan.Y);
                var node: HTMLElement = this.div;
                // wished there was an easier way to do this
                while (node != null) {
                    this.currentPosition.X -= node.offsetLeft;
                    this.currentPosition.Y -= node.offsetTop;
                    node = <HTMLElement> node.offsetParent;
                }
                this.currentPosition.X /= this.Zoom;
                this.currentPosition.Y /= this.Zoom;
                //console.log(this.currentPosition.toString());
            }

            private UpdateCurrentTouchPosition(e: TouchEvent) {
                this.isShiftPressed = false;
                this.currentPosition = new Point(e.touches[0].pageX, e.touches[0].pageY);
                var node: HTMLElement = this.div;
                while (node != null) {
                    this.currentPosition.X -= node.offsetLeft;
                    this.currentPosition.Y -= node.offsetTop;
                    node = <HTMLElement> node.offsetParent;
                }
            }

            private Refresh() {
                var connections: Connection[] = [];
                for (var i = 0; i < this.shapes.length; i++) {
                    var item: Shape = this.shapes[i];
                    for (var j = 0; j < item.Connectors.length; j++) {
                        var connector: Connector = item.Connectors[j];
                        for (var k = 0; k < connector.Connections.length; k++) {
                            var connection: Connection = connector.Connections[k];
                            if (!connections.Contains(connection)) {
                                connection.paint(this.canvas);
                                connections.push(connection);
                            }
                        }
                    }
                }
                for (var i = 0; i < this.shapes.length; i++) this.shapes[i].paint(this.canvas);
                for (var i = 0; i < this.shapes.length; i++) {
                    var item = this.shapes[i];
                    for (var j = 0; j < item.Connectors.length; j++) {
                        var connector: Connector = item.Connectors[j];
                        var IsHovered: boolean = false;
                        for (var k = 0; k < connector.Connections.length; k++)
                            if (connector.Connections[k].IsHovered) IsHovered = true;
                        if ((item.IsHovered) || (connector.IsHovered) || IsHovered) connector.Invalidate((this.newConnection != null) ? this.newConnection.From : null);
                        else if ((this.newConnection != null) && (connector.CanConnectTo(this.newConnection.From))) connector.Invalidate(this.newConnection.From);
                    }
                }

                if (this.newItem != null) this.newItem.paint(this.canvas);
                if (this.newConnection != null) this.newConnection.paintAdorner(this.canvas);
                if (this.selector.IsActive) this.selector.paint(this.canvas);
            }
        }

        /**
         * Mapping of logical cursors to actual cursors.
         */
        export class Cursors {
            static arrow: string = "default";
            static grip: string = "pointer";
            static cross: string = "pointer";
            static add: string = "pointer";
            static MoveTo: string = "move";
            static select: string = "pointer";
        }


        /**
         * Defines basic Control properties.
         */
        export interface IFrameworkElement {
            IsHovered: boolean;
            GetCursor(point: Point): string;
        }

        /**
         * Defines an element participating in the diagram logic.
         */
        export interface IDiagramItem extends IFrameworkElement {
            IsSelected: boolean;
            Diagram: DiagramSurface;
        }

        /**
         * Defines an undo-redo unit.
         */
        export interface IUndoUnit {
            Title: string;
            Undo(): void;
            Redo(): void;
            IsEmpty: boolean;
        }

        /**
         * Defines a shape.
         */
        export interface IShapeTemplate {
            Id: string;
            IsResizable: boolean;
            Width: number;
            Height: number;
            Rotation: number;
            Background: string;
            DefaultContent: any;
            ConnectorTemplates: IConnectorTemplate[];
            Edit(element: Shape, canvas: Canvas, point: Point);
            Clone(): IShapeTemplate;
            Geometry: string;
            Stroke: string;
            CornerRadius: number;
            Position: Point;
            StrokeThickness: number;
            Opacity: number;
        }

        /**
         * Defines a connector.
         */
        export interface IConnectorTemplate {
            Name: string;
            Type: string;
            Description: string;
            GetConnectorPosition(element: Shape): Point;
            CanConnectTo(other: Connector): boolean;
        }

        export interface ITheme {
            background: string;
            connection: string;
            selection: string;
            connector: string;
            connectorBorder: string;
            connectorHover: string;
            connectorHoverBorder: string;
        }

        /**
         * The diagramming connection.
         */
        export class Connection implements IDiagramItem {
            private fromConnector: Connector;
            private toConnector: Connector;
            private toPoint: Point = null;
            private isSelected: boolean;
            private isHovered: boolean;
            private visual: Group;
            private path: SVG.Path;
            public Diagram: DiagramSurface;
            private endCap: Marker;
            private startCap: Marker;
            private unselectedColor: string;
            private contentVisual: Visual;
            private points: Array<Point>;
            public get Visual() {
                return this.visual;
            }
            /*Sets the intermediate points in global coordinates.*/
            public set Points(ps: Array<Point>) {
                this.points = ps;
                this.updateVisual();
            }
            public get Points(): Array<Point> {
                return this.points;
            }
            public set Content(v: any) {
                if (v == null) this.removeContent();
                var tb = new SVG.TextBlock();
                tb.dy = -5;
                tb.Text = v.toString();
                this.contentVisual = tb;
                this.visual.Append(this.contentVisual);
                this.Invalidate();
            }

            private removeContent() {
                if (this.contentVisual == null) return;
                this.visual.Remove(this.contentVisual);
                this.contentVisual = null;
            }

            constructor(from: Connector, to: Connector, options?);
            constructor(from: Shape, to: Shape, options?);
            constructor(from, to, options?) {
                if (from instanceof Shape) { from = (<Shape>from).Connectors[0]; }
                if (to instanceof Shape) { to = (<Shape>to).Connectors[0]; }
                options = options || {};
                this.fromConnector = from;
                this.toConnector = to;
                this.createVisual();
                if (options.id) this.Id = options.id;
                this.points = [];
            }
            /*
            * Gets whether this shape is visible.
            */
            public get IsVisible() {
                return (this.Visual.Native.attributes["visibility"] == null) ? true : this.Visual.Native.attributes["visibility"].value == "visible";
            }

            /*
             * Sets whether this shape is visible.
             */
            public set IsVisible(value: boolean) {
                if (value) this.Visual.Native.setAttribute("visibility", "visible");
                else this.Visual.Native.setAttribute("visibility", "hidden");
            }
            public get Id() { return this.Visual.Native.id; }
            public set Id(id) { this.Visual.Native.id = id; }
            private createVisual() {
                var g = new Group; //the group contains the line and the label
                this.path = new SVG.Path();
                var interpolator = TypeViz.SVG.Interpolate({
                    /* xProjector: w=> w.X,
                     yProjector: w=> w.Y,*/
                    Interpolator: TypeViz.SVG.Interpolators.SplineInterpolator,
                    IsClosed: false
                });
                this.path.Interpolator = interpolator;
                this.path.Stroke = "Green";
                g.Append(this.path);
                this.visual = g;
                this.updateCoordinates();
                this.unselectedColor = this.path.Stroke;
                this.path.StrokeThickness = 1;
            }

            private updateCoordinates() {
                if (this.toConnector == null) {
                    var merged;
                    // means we are dragging a new connection
                    if (this.toPoint == null || isNaN(this.toPoint.X) || isNaN(this.toPoint.Y)) return;
                    var globalSourcePoint = this.fromConnector.Parent.GetConnectorPosition(this.fromConnector);
                    var globalSinkPoint = this.toPoint;
                    var bounds = Rect.FromPoints(globalSourcePoint, globalSinkPoint);
                    var localSourcePoint = globalSourcePoint.Minus(bounds.TopLeft);
                    var localSinkPoint = globalSinkPoint.Minus(bounds.TopLeft);


                    if (TypeViz.IsDefined(this.points) && this.points.length > 0) {
                        merged = [localSourcePoint];
                        for (var i = 0; i < this.points.length; i++) {
                            merged.push(this.points[i].Minus(bounds.TopLeft));
                        }
                        merged.push(localSinkPoint);
                        this.path.Points = merged;
                    }
                    else {
                        this.path.Points = [localSourcePoint, localSinkPoint];// [globalSourcePoint, globalSinkPoint];
                    }

                    this.visual.Position = bounds.TopLeft;//global coordinates!
                    return;
                }
                var globalSourcePoint = this.fromConnector.Parent.GetConnectorPosition(this.fromConnector);
                var globalSinkPoint = this.toConnector.Parent.GetConnectorPosition(this.toConnector);
                var bounds = Rect.FromPoints(globalSourcePoint, globalSinkPoint);
                var localSourcePoint = globalSourcePoint.Minus(bounds.TopLeft);
                var localSinkPoint = globalSinkPoint.Minus(bounds.TopLeft);

                if (TypeViz.IsDefined(this.points) && this.points.length > 0) {
                    merged = [localSourcePoint];
                    for (var i = 0; i < this.points.length; i++) {
                        merged.push(this.points[i].Minus(bounds.TopLeft));
                    }
                    merged.push(localSinkPoint);
                    this.path.Points = merged;
                }
                else {
                    this.path.Points = [localSourcePoint, localSinkPoint];// [globalSourcePoint, globalSinkPoint];
                }
                this.visual.Position = bounds.TopLeft;//global coordinates!

                if (this.contentVisual != null) {
                    var m = Point.MiddleOf(localSourcePoint, localSinkPoint);
                    this.contentVisual.Position = m;
                    var p = localSinkPoint.Minus(localSourcePoint);
                    var tr = this.contentVisual.Native.ownerSVGElement.createSVGTransform();
                    tr.setRotate(p.ToPolar(true).Angle, m.X, m.Y);
                    var tb = <SVGTextElement>this.contentVisual.Native;
                    if (tb.transform.baseVal.numberOfItems == 0)
                        tb.transform.baseVal.appendItem(tr);
                    else
                        tb.transform.baseVal.replaceItem(tr, 0);

                }

            }

            private updateVisual() {
                this.updateCoordinates();
                if (this.isSelected) {
                    this.path.Stroke = "Orange";
                    this.path.StrokeThickness = 2;
                    if (this.EndCap != null) this.EndCap.Color = "Orange";
                    if (this.StartCap != null) this.StartCap.Color = "Orange";

                }
                else {
                    this.path.Stroke = this.unselectedColor;
                    this.path.StrokeThickness = 1;
                    if (this.EndCap != null) this.EndCap.Color = this.unselectedColor;
                    if (this.StartCap != null) this.StartCap.Color = this.unselectedColor;
                }
            }

            private updateContent() {

            }

            public set EndCap(marker: Marker) {
                if (marker == null) throw "Given Marker is null.";
                if (marker.Id == null) throw "Given Marker has no Id.";
                marker.Color = this.Stroke;
                this.Diagram.AddMarker(marker);
                this.path.MarkerEnd = marker;
                this.endCap = marker;
            }

            public get EndCap() {
                return this.endCap;
            }

            public set StartCap(marker: Marker) {
                if (marker == null) throw "Given Marker is null.";
                if (marker.Id == null) throw "Given Marker has no Id.";
                marker.Color = this.Stroke;
                this.Diagram.AddMarker(marker);
                this.path.MarkerStart = marker;
                this.startCap = marker;
            }

            public get StartCap() {
                return this.startCap;
            }

            public set Stroke(value: string) {
                this.path.Stroke = value;
                this.unselectedColor = value;
            }

            public get Stroke(): string {
                return this.path.Stroke;
            }

            public set Opacity(value: number) {
                this.path.Opacity = value;
            }

            public get Opacity(): number {
                return this.path.Opacity;
            }

            public set StrokeDash(value: string) {
                this.path.StrokeDash = value;
            }

            public get StrokeDash(): string {
                return this.path.StrokeDash;
            }

            /**
             *  Gets the source connector.
             */
            public get From(): Connector {
                return this.fromConnector;
            }

            /**
             * Sets the source connector.
             */
            public set From(v: Connector) {
                this.fromConnector = v;
            }

            /**
             *  Gets the sink connector.
             */
            public get To(): Connector {
                return this.toConnector;
            }

            /**
             * Sets the target connector.
             */
            public set To(v: Connector) {
                this.toConnector = v;
            }

            /**
             *  Gets whether this connection is selected.
             */
            public get IsSelected(): boolean {
                return this.isSelected;
            }

            /**
             *  Sets whether this connection is selected.
             */
            public set IsSelected(value: boolean) {
                this.isSelected = value;
                this.Invalidate();
            }

            /**
             *  Gets whether this connection is hovered.
             */
            public get IsHovered(): boolean {
                return this.isHovered;
            }

            /**
             *  Sets whether this connection is hovered.
             */
            public set IsHovered(value: boolean) {
                this.isHovered = value;
            }

            public UpdateEndPoint(toPoint: Point) {
                this.toPoint = toPoint;
                this.updateCoordinates();
            }

            public GetCursor(point: Point): string {
                return Cursors.select;
            }

            public HitTest(rectangle: Rect): boolean {
                if ((this.From != null) && (this.To != null)) {
                    var p1: Point = this.From.Parent.GetConnectorPosition(this.From);
                    var p2: Point = this.To.Parent.GetConnectorPosition(this.To);
                    if ((rectangle.Width != 0) || (rectangle.Width != 0)) return (rectangle.Contains(p1) && rectangle.Contains(p2));

                    var p: Point = rectangle.TopLeft;

                    // p1 must be the leftmost point
                    if (p1.X > p2.X) {
                        var temp = p2;
                        p2 = p1;
                        p1 = temp;
                    }

                    var r1 = new Rect(p1.X, p1.Y, 0, 0);
                    var r2 = new Rect(p2.X, p2.Y, 0, 0);
                    r1.Inflate(3, 3);
                    r2.Inflate(3, 3);

                    if (r1.Union(r2).Contains(p)) {
                        if ((p1.X == p2.X) || (p1.Y == p2.Y)) return true;
                        else if (p1.Y < p2.Y) {
                            var o1 = r1.X + (((r2.X - r1.X) * (p.Y - (r1.Y + r1.Height))) / ((r2.Y + r2.Height) - (r1.Y + r1.Height)));
                            var u1 = (r1.X + r1.Width) + ((((r2.X + r2.Width) - (r1.X + r1.Width)) * (p.Y - r1.Y)) / (r2.Y - r1.Y));
                            return ((p.X > o1) && (p.X < u1));
                        }
                        else {
                            var o2 = r1.X + (((r2.X - r1.X) * (p.Y - r1.Y)) / (r2.Y - r1.Y));
                            var u2 = (r1.X + r1.Width) + ((((r2.X + r2.Width) - (r1.X + r1.Width)) * (p.Y - (r1.Y + r1.Height))) / ((r2.Y + r2.Height) - (r1.Y + r1.Height)));
                            return ((p.X > o2) && (p.X < u2));
                        }
                    }
                }
                return false;
            }

            public Invalidate() {
                this.updateVisual();
            }

            public paint(context: Canvas) {
                //context.strokeStyle = this.From.Parent.graph.theme.connection;
                //context.lineWidth = (this.isHovered) ? 2 : 1;
                //this.paintLine(context, this.isSelected);
            }

            public paintAdorner(context: Canvas) {
                //context.strokeStyle = this.From.Parent.graph.theme.connection;
                //context.lineWidth = 1;
                this.paintLine(context, true);
            }

            public paintLine(context: Canvas, dashed: boolean) {
                if (this.From != null) {
                    var Start: Point = this.From.Parent.GetConnectorPosition(this.From);
                    var end: Point = (this.To != null) ? this.To.Parent.GetConnectorPosition(this.To) : this.toPoint;
                    //if ((Start.X != end.X) || (Start.Y != end.Y))
                    //{
                    //    context.beginPath();
                    //    if (dashed)
                    //    {
                    //        LineHelper.dashedLine(context, Start.X, Start.Y, end.X, end.Y);
                    //    }
                    //    else
                    //    {
                    //        context.moveTo(Start.X - 0.5, Start.Y - 0.5);
                    //        context.lineTo(end.X - 0.5, end.Y - 0.5);
                    //    }
                    //    context.closePath();
                    //    context.stroke();
                    //}
                }
            }
        }

        /**
         * The intermediate between a shape and a connection, aka port.
         */
        export class Connector implements IFrameworkElement {
            private parent: Shape;
            private template: IConnectorTemplate;
            private connections: Connection[] = [];
            private isHovered: boolean = false;
            public Visual: SVG.Visual;

            constructor(parent: Shape, template: IConnectorTemplate) {
                this.parent = parent;
                this.template = template;
            }

            public get Parent(): Shape {
                return this.parent;
            }

            /*
             * Gets the template of this connector
             */
            public get Template(): IConnectorTemplate {
                return this.template;
            }

            public get Connections(): Connection[] {
                return this.connections;
            }

            public set Background(value) {
                this.Visual.Native.setAttribute("fill", value);
            }

            public get IsHovered(): boolean {
                return this.isHovered;
            }

            public set IsHovered(value: boolean) {
                this.isHovered = value;
                this.IsVisible = value;
                this.Background = value ? "Green" : "Black";
            }

            public GetCursor(point: Point): string {
                return Cursors.grip;
            }

            public HitTest(r: Rect): boolean {
                if ((r.Width === 0) && (r.Height === 0)) return this.Rectangle.Contains(r.TopLeft);
                return r.Contains(this.Rectangle.TopLeft);
            }

            public get IsVisible() {
                return (this.Visual.Native.attributes["visibility"] == null) ? true : this.Visual.Native.attributes["visibility"].value == "visible";
            }

            public set IsVisible(value: boolean) {
                if (value) this.Visual.Native.setAttribute("visibility", "visible");
                else this.Visual.Native.setAttribute("visibility", "hidden");
            }

            public Invalidate(other?: Connector) {
                var r = this.Rectangle;
                var strokeStyle: string = this.parent.Diagram.Theme.connectorBorder;
                var fillStyle: string = this.parent.Diagram.Theme.connector;
                if (this.isHovered) {
                    strokeStyle = this.parent.Diagram.Theme.connectorHoverBorder;
                    fillStyle = this.parent.Diagram.Theme.connectorHover;
                    if (other != null && !this.CanConnectTo(other)) fillStyle = "#f00";
                }
                this.Visual.Native.setAttribute("fill", fillStyle);
            }

            public CanConnectTo(other: Connector): boolean {
                if (other === this) return false;
                if (other == null) return true;
                return this.Template.CanConnectTo(other);
                //var t1: string[] = this.template.Type.split(' ');
                //if (!t1.Contains("[array]") && (this.connections.length == 1)) return false;
                //if (connector instanceof Connector)
                //{
                //    var t2: string[] = connector.template.Type.split(' ');
                //    if ((t1[0] != t2[0]) ||
                //        (this.parent == connector.parent) ||
                //        (t1.Contains("[in]") && !t2.Contains("[out]")) ||
                //        (t1.Contains("[out]") && !t2.Contains("[in]")) ||
                //        (!t2.Contains("[array]") && (connector.connections.length == 1)))
                //    {
                //        return false;
                //    }
                //}


            }

            public toString() {
                return "Connector";
            }

            private get Rectangle(): Rect {
                var point = this.parent.GetConnectorPosition(this);
                var rectangle = new Rect(point.X, point.Y, 0, 0);
                rectangle.Inflate(3, 3);
                return rectangle;
            }
        }

        export class CompositeUnit implements IUndoUnit {

            constructor(unit: IUndoUnit = null) {
                if (unit != null) this.units.push(unit);
            }

            private units: IUndoUnit[] = [];

            public Add(undoUnit: IUndoUnit) {
                this.units.push(undoUnit);
            }

            public Undo() {
                for (var i = 0; i < this.units.length; i++) this.units[i].Undo();
            }

            public Redo() {
                for (var i = 0; i < this.units.length; i++) this.units[i].Redo();
            }

            public get Title() {
                return "Composite unit";
            }

            public get IsEmpty() {
                if (this.units.length > 0) {
                    for (var i = 0; i < this.units.length; i++) {
                        if (!this.units[i].IsEmpty) {
                            return false;
                        }
                    }
                }
                return true;
            }
        }


        export interface Touch {
            identifier: number;
            target: EventTarget;
            screenX: number;
            screenY: number;
            clientX: number;
            clientY: number;
            pageX: number;
            pageY: number;
        }


        export interface TouchList {
            length: number;
            item(index: number): Touch;
            identifiedTouch(identifier: number): Touch;
        }


        export interface TouchEvent extends UIEvent {
            touches: TouchList;
            targetTouches: TouchList;
            changedTouches: TouchList;
            altKey: boolean;
            metaKey: boolean;
            ctrlKey: boolean;
            shiftKey: boolean;
            initTouchEvent(type: string, canBubble: boolean, cancelable: boolean, view: any, detail: number, ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean, touches: TouchList, targetTouches: TouchList, changedTouches: TouchList);
        }
        ;

    export declare var TouchEvent: {
            prototype: TouchEvent;
            new (): TouchEvent;
        }

    export class ContentChangedUndoUnit implements IUndoUnit {
            public get Title() {
                return "Content Editing";
            }

            private item: Shape;
            private _undoContent: any;
            private _redoContent: any;

            constructor(element: Shape, content: any) {
                this.item = element;
                this._undoContent = element.Content;
                this._redoContent = content;
            }

            public Undo() {
                this.item.Content = this._undoContent;
            }

            public Redo() {
                this.item.Content = this._redoContent;
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the deletion of a connection.
         */
        export class DeleteConnectionUnit implements IUndoUnit {
            private connection: Connection;
            private from: Connector;
            private to: Connector;
            private diagram: DiagramSurface;

            public get Title() {
                return "Delete connection";
            }


            constructor(connection: Connection) {
                this.connection = connection;
                this.diagram = connection.Diagram;
                this.from = connection.From;
                this.to = connection.To;
            }

            public Undo() {
                this.diagram.AddConnection(this.connection);
            }

            public Redo() {
                this.diagram.RemoveConnection(this.connection);
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the deletion of a diagram element.
         */
        export class DeleteShapeUnit implements IUndoUnit {
            public get Title() {
                return "Deletion";
            }

            private shape: Shape;
            private diagram: DiagramSurface;

            constructor(shape: Shape) {
                this.shape = shape;
                this.diagram = shape.Diagram;
            }

            public Undo() {
                this.diagram.AddItem(this.shape);
                this.shape.IsSelected = false;
            }

            public Redo() {
                this.shape.IsSelected = false;
                this.diagram.RemoveShape(this.shape);
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the transformation of a diagram element.
         */
        export class TransformUnit implements IUndoUnit {
            public get Title() {
                return "Transformation";
            }

            private shape: Shape;
            private undoRectangle: Rect;
            private redoRectangle: Rect;

            constructor(shape: Shape, undoRectangle: Rect, redoRectangle: Rect) {
                this.shape = shape;
                this.undoRectangle = undoRectangle.Clone();
                this.redoRectangle = redoRectangle.Clone();
            }

            public Undo() {
                // if (this.shape.IsSelected) this.shape.Adorner.Rectangle = this.undoRectangle;
                this.shape.Rectangle = this.undoRectangle;
                this.shape.Invalidate();
            }

            public Redo() {
                //if (this.shape.IsSelected)
                //{
                //    this.shape.Adorner.Rectangle = this.redoRectangle;
                //    this.shape.Adorner.paint
                //}
                this.shape.Rectangle = this.redoRectangle;
                this.shape.Invalidate();

            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the addition of a connection.
         */
        export class AddConnectionUnit implements IUndoUnit {
            private connection: Connection;
            private from: Connector;
            private to: Connector;

            public get Title() {
                return "New connection";
            }

            private diagram: DiagramSurface;

            constructor(connection: Connection, from: Connector, to: Connector) {
                this.connection = connection;
                this.diagram = connection.Diagram;
                this.from = from;
                this.to = to;
            }

            public Undo() {
                this.diagram.RemoveConnection(this.connection);
            }

            public Redo() {
                this.diagram.AddConnection(this.connection);
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the addition of diagram item.
         */
        export class AddShapeUnit implements IUndoUnit {
            private shape: Shape;
            private diagram: DiagramSurface;

            public get Title() {
                return "Insert";
            }

            constructor(shape: Shape, diagram: DiagramSurface) {
                this.shape = shape;
                this.diagram = diagram;
            }

            public Undo() {
                this.diagram.RemoveShape(this.shape);
            }

            public Redo() {
                this.diagram.AddItem(this.shape);
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /**
         * An undo-redo unit handling the selection of items.
         */
        export class SelectionUndoUnit implements IUndoUnit {
            private shapeStates: any[] = [];

            public get Title() {
                return "Selection Unit";
            }

            public Undo() {
                for (var i: number = 0; i < this.shapeStates.length; i++) this.shapeStates[i].Item.IsSelected = this.shapeStates[i].undo;
            }

            public Redo() {
                for (var i: number = 0; i < this.shapeStates.length; i++) this.shapeStates[i].Item.IsSelected = this.shapeStates[i].redo;
            }

            public get IsEmpty(): boolean {
                for (var i = 0; i < this.shapeStates.length; i++)
                    if (this.shapeStates[i].undo != this.shapeStates[i].redo) return false;
                return true;
            }

            public select(item: IDiagramItem) {
                this.Refresh(item, item.IsSelected, true);
            }

            public deselect(Item: IDiagramItem) {
                this.Refresh(Item, Item.IsSelected, false);
            }

            private Refresh(item: IDiagramItem, undo: boolean, redo: boolean) {
                for (var i = 0; i < this.shapeStates.length; i++) {
                    if (this.shapeStates[i].Item == item) {
                        this.shapeStates[i].redo = redo;
                        return;
                    }
                }
                this.shapeStates.push({ Item: item, undo: undo, redo: redo });
            }
        }
        /**
            * An undo-redo unit handling the selection of items.
            */
        export class PanUndoUnit implements IUndoUnit {
            private initial: Point;
            private final: Point;
            private diagram: DiagramSurface;
            constructor(initial: Point, final: Point, diagram: DiagramSurface) {
                this.initial = initial;
                this.final = final;
                this.diagram = diagram;
            }
            public get Title() {
                return "Pan Unit";
            }

            public Undo() {
                this.diagram.Pan = this.initial;
            }

            public Redo() {
                this.diagram.Pan = this.final;
            }

            public get IsEmpty(): boolean {
                return false;
            }
        }

        /*
         * The node or shape.
         */
        export class Shape implements IDiagramItem {
            private template: IShapeTemplate;
            private rectangle: Rect;

            private _content;
            private isHovered: boolean = false;
            private isSelected: boolean = false;
            private adorner: ResizingAdorner = null;
            private connectors: Connector[] = [];
            public Diagram: DiagramSurface;
            private visual: Group;
            private mainVisual: Visual;
            private rotation: SVG.Rotation = new SVG.Rotation(0);
            private translation: SVG.Translation = new SVG.Translation(0, 0);
            public get Id() { return this.Visual.Native.id; }
            public set Id(id) { this.Visual.Native.id = id; }
            public get bounds() {
                return new TypeViz.Rect(this.Position.X, this.Position.Y, this.Width, this.Height);
            }
            public set bounds(r) {
                this.Position = r.TopLeft;
                this.Width = r.Width;
                this.Height = r.Height;
            }
            /*
             * Gets whether this shape is visible.
             */
            public get IsVisible() {
                return (this.Visual.Native.attributes["visibility"] == null) ? true : this.Visual.Native.attributes["visibility"].value == "visible";
            }

            /*
             * Sets whether this shape is visible.
             */
            public set IsVisible(value: boolean) {
                if (value) this.Visual.Native.setAttribute("visibility", "visible");
                else this.Visual.Native.setAttribute("visibility", "hidden");
            }

            /*
             * Gets SVG visual this shape represents.
             */
            public get Visual(): SVG.Visual {
                return this.visual;
                ;
            }

            /*
             * Instantiates a new Shape.
             */
            constructor(template: IShapeTemplate, point: Point) {
                this.template = template;
                this._content = template.DefaultContent;
                this.rectangle = Rect.Create(point.X, point.Y, Math.floor(template.Width), Math.floor(template.Height));
                this.createVisual();
            }

            private getTemplateVisual(): Visual {
                if (this.template == null) throw "Template is not set.";
                if (this.template.Geometry == null) throw "Geometry is not set in the template.";
                var v: Visual = null;
                if (this.template.Geometry.toLowerCase() == "rectangle") {
                    v = new SVG.Rectangle();
                }
                else if (this.template.Geometry.toLowerCase() == "circle") {
                    v = new SVG.Circle();
                }
                else {
                    var path = new PathBase();
                    path.Data = this.template.Geometry;
                    v = path;
                }
                v.Stroke = this.template.Stroke;
                v.StrokeThickness = this.template.StrokeThickness;
                v.Background = this.template.Background;
                v.Width = this.template.Width;
                v.Height = this.template.Height;
                v.Opacity = this.Template.Opacity;

                if (v instanceof SVG.Rectangle) {
                    (<SVG.Rectangle>v).CornerRadius = this.Template.CornerRadius;
                }
                if (this.template.Rotation != 0) {
                    var r = this.template.Rotation;
                    //                if(r == 90 || r == 270 || r == 83)
                    //                {
                    //                   v.Height = v.Width;
                    //                   v.Width = v.Height;
                    //                   console.log(v.Id);
                    //                }
                }
                return v;
            }

            public get Width(): number {
                return this.Rectangle.Width;
            }

            public set Width(v: number) {
                this.Rectangle.Width = v;
                this.Invalidate();
            }

            public get Height(): number {
                return this.Rectangle.Height;
            }

            public set Height(v: number) {
                this.Rectangle.Height = v;
                this.Invalidate();
            }

            /**
             * Gets the CSS class of this shape.
             */
            public set Class(v: string) {
                this.visual.Class = v;
            }

            /**
             * Sets the CSS class of this shape.
             */
            public get Class(): string {
                return this.visual.Class;
            }

            /*
             * Creates the underlying SVG hierarchy for this shape on the basis of the set IShapeTemplate.
             */
            private createVisual() {
                var g = new Group();
                g.Id = this.template.Id;
                g.Position = this.rectangle.TopLeft;

                var vis = this.getTemplateVisual();
                vis.Position = Point.Empty;
                g.Append(vis);
                this.mainVisual = vis; //in order to update
                g.Title = (g.Id == null || g.Id.length == 0) ? "Shape" : g.Id;
                if (this.template.hasOwnProperty("ConnectorTemplates")) {
                    if (this.template.ConnectorTemplates != null
                        && this.template.ConnectorTemplates.length > 0) {
                        this.createConnectors(g);
                    }
                }
                else {
                    this.template.ConnectorTemplates = ShapeTemplateBase.DefaultConnectorTemplates;
                    this.createConnectors(g);
                }
                //if (this.template.Rotation != 0)
                //{
                //    var rot = new SVG.Rotation(this.template.Rotation);
                //    g.PrePendTransform(rot);
                //}
                var tb = new SVG.TextBlock();
                tb.Text = this.Content;
                tb.Background = "White";
                tb.FontFamily = "Segoe UI";
                tb.FontSize = 15;
                tb.X = 10;
                tb.Y = 20;
                g.Append(tb);
                this.visual = g;
            }

            createConnectors(g) {

                for (var i = 0; i < this.template.ConnectorTemplates.length; i++) {
                    var ct = this.template.ConnectorTemplates[i];
                    var connector = new Connector(this, ct);
                    var c = new SVG.Rectangle();
                    c.Width = 7;
                    c.Height = 7;
                    var relative = ct.GetConnectorPosition(this);
                    c.Position = new Point(relative.X - 3, relative.Y - 3);
                    connector.Visual = c;
                    connector.IsVisible = false;
                    connector.Parent = this;
                    var text = (ct.Description == null || ct.Description.length == 0) ? ct.Name : ct.Description;
                    c.Title = text;
                    g.Append(c);
                    this.Connectors.push(connector);
                }
            }
            /**
             * Sets the title of this visual.
             */
            public get Title(): string {
                return this.visual.Title;
            }

            /**
             * Gets the title of this visual.
             */
            public set Title(v: string) {
                this.visual.Title = v;
            }

            /*
             * Gets the bounding rectangle of this shape.
             */
            public get Rectangle(): Rect {
                return ((this.adorner != null)) ? this.adorner.Rectangle : this.rectangle;//&& (this.adorner.IsManipulation)
            }

            /*
             * Sets the bounding rectangle of this shape.
             */
            public set Rectangle(r: Rect) {
                this.rectangle = r;
                if (this.adorner != null) this.adorner.UpdateRectangle(r);
                this.Invalidate();
            }

            /*
             * Gets the shape template.
             */
            public get Template(): IShapeTemplate {
                return this.template;
            }

            /*
             * Gets the connectors of this shape.
             */
            public get Connectors(): Connector[] {
                return this.connectors;
            }

            /*
             * Gets the resizing adorner of this shape.
             */
            public get Adorner(): ResizingAdorner {
                return this.adorner;
            }

            /*
             * Gets whether this shape is selected.
             */
            public get IsSelected(): boolean {
                return this.isSelected;
            }

            /*
             * Sets whether this shape is selected.
             */
            public set IsSelected(value: boolean) {
                if (this.isSelected != value) {
                    this.isSelected = value;

                    if (this.isSelected) {
                        this.adorner = new ResizingAdorner(this.Rectangle, this.template.IsResizable);
                        this.Diagram.MainLayer.Append(this.adorner.Visual);
                        this.Invalidate();
                    }
                    else {
                        this.Invalidate();
                        this.Diagram.MainLayer.Remove(this.adorner.Visual);
                        this.adorner = null;
                    }
                }
            }

            /*
             * Gets whether the mouse pointer is currently over this shape.
             */
            public get IsHovered(): boolean {
                return this.isHovered;
            }

            /*
             * Sets whether the mouse pointer is currently over this shape.
             */
            public set IsHovered(value: boolean) {
                this.isHovered = value;
                if (this.Connectors.length > 0)
                    for (var i = 0; i < this.Connectors.length; i++) this.Connectors[i].IsVisible = value;

            }

            public paint(context: Canvas) {
                //this.template.paint(this, context);
                if (this.isSelected) this.adorner.paint(context);
            }
            public set Position(value: Point) {
                this.translation.X = value.X;
                this.translation.Y = value.Y;
                this.visual.Native.setAttribute("transform", this.translation.toString() + this.rotation.toString());
            }
            public Invalidate() {
                this.Position = this.Rectangle.TopLeft;
                this.mainVisual.Width = this.Rectangle.Width;
                this.mainVisual.Height = this.Rectangle.Height;
                if (this.Connectors.length > 0) {
                    var cons = [];
                    for (var i = 0; i < this.Connectors.length; i++) {
                        var c = this.Connectors[i];
                        var ct = this.Template.ConnectorTemplates[i];
                        var relative = ct.GetConnectorPosition(this);
                        c.Visual.Position = new Point(relative.X - 3, relative.Y - 3);
                        if (c.Connections.length > 0) {
                            for (var j = 0; j < c.Connections.length; j++)
                                if (!cons.Contains(c.Connections[j])) cons.push(c.Connections[j]);
                        }
                    }
                    cons.ForEach((con: Connection) => con.Invalidate());
                }
            }

            public toString() {
                return (this.Template == null) ? "Shape" : ("Shape '" + this.Template.Id) + "'";
            }

            /**
             * Hit testing of this item with respect to the given rectangle.
             * @param r The rectangle to test.
             */
            public HitTest(r: Rect): boolean {
                if ((r.Width === 0) && (r.Height === 0)) {
                    if (this.Rectangle.Contains(r.TopLeft)) return true;
                    if ((this.adorner != null)) {
                        var h = this.adorner.HitTest(r.TopLeft);
                        if ((h.X >= -1) && (h.X <= +1) && (h.Y >= -1) && (h.Y <= +1)) return true;
                    }
                    for (var i = 0; i < this.connectors.length; i++)
                        if (this.connectors[i].HitTest(r)) return true;

                    return false;
                }
                return r.Contains(this.Rectangle.TopLeft);
            }

            public GetCursor(point: Point): string {
                if (this.adorner != null) {
                    var cursor = this.adorner.GetCursor(point);
                    if (cursor != null) return cursor;
                }
                if (window.event.shiftKey) return Cursors.add;
                return Cursors.select;
            }

            public GetConnector(name: string): Connector {
                for (var i: number = 0; i < this.connectors.length; i++) {
                    var connector = this.connectors[i];
                    if (connector.Template.Name == name) return connector;
                }
                return null;
            }

            public GetConnectorPosition(connector: Connector): Point {
                var r = this.Rectangle;
                var point: Point = connector.Template.GetConnectorPosition(this);
                point.X += r.X;
                point.Y += r.Y;
                return point;
            }

            public setContent(content: any) {
                this.Diagram.setElementContent(this, content);
            }

            public get Content(): any {
                return this._content;
            }

            public set Content(value: any) {
                this._content = value;
            }
        }

        /**
         * The service handling the undo-redo stack.
         */
        export class UndoRedoService {
            private composite: CompositeUnit = null;
            private stack: CompositeUnit[] = [];
            private index: number = 0;

            /**
             * Starts a new composite unit which can be either cancelled or committed.
             */
            public begin() {
                this.composite = new CompositeUnit();
            }

            public Cancel() {
                this.composite = null;
            }

            public commit() {
                if (!this.composite.IsEmpty) {
                    // throw away anything beyond this point if this is a new branch
                    this.stack.splice(this.index, this.stack.length - this.index);
                    this.stack.push(this.composite);
                    this.Redo();
                }
                this.composite = null;
            }

            /**
             * Adds the given undoable unit to the current composite. Use the simple add() method if you wish to do things in one swing.
             * @param undoUnit The undoable unit to add.
             */
            public AddCompositeItem(undoUnit: IUndoUnit) {
                if (this.composite == null) throw "Use begin() to initiate and then add an undoable unit.";
                this.composite.Add(undoUnit);
            }

            /**
             * Adds the given undoable unit to the stack and executes it.
             * @param undoUnit The undoable unit to add.
             */
            public Add(undoUnit: IUndoUnit) {
                if (undoUnit == null) throw "No undoable unit supplied."
            // throw away anything beyond this point if this is a new branch
            this.stack.splice(this.index, this.stack.length - this.index);
                this.stack.push(new CompositeUnit(undoUnit));
                this.Redo();
            }

            /**
             * Returns the number of composite units in this undo-redo stack.
             */
            public count() {
                return this.stack.length;
            }

            public Undo() {
                if (this.index != 0) {
                    this.index--;
                    this.stack[this.index].Undo();
                }
            }

            public Redo() {
                if ((this.stack.length != 0) && (this.index < this.stack.length)) {
                    this.stack[this.index].Redo();
                    this.index++;
                }
                else {
                    throw "Reached the end of the undo-redo stack.";
                }
            }
        }
        interface PointVisualMap {
            [p: string]: SVG.Rectangle;
        }

        /**
         * The adorner supporting the scaling of items.
         */
        export class ResizingAdorner {
            private rectangle: Rect;
            private isresizable: boolean;
            private isManipulating: boolean = false;
            private currentHandle: Point;
            private currentPoint: Point;
            private map: PointVisualMap = {};
            private visual: Group;
            private text: SVG.TextBlock;

            public get Visual() {
                return this.visual;
            }

            private initialState: Rect = null;
            private finalState: Rect = null;

            public get InitialState() {
                return this.initialState;
            }

            public get FinalState() {
                return this.finalState;
            }

            constructor(rectangle: Rect, resizable: boolean) {
                this.rectangle = rectangle.Clone();
                this.isresizable = resizable;
                this.createVisuals();
            }

            public get Rectangle(): Rect {
                return this.rectangle;
            }

            private createVisuals() {
                var g = new Group();
                for (var x: number = -1; x <= +1; x++) {
                    for (var y: number = -1; y <= +1; y++) {
                        if ((x != 0) || (y != 0)) {
                            var r = this.GetHandleBounds(new Point(x, y));
                            var visual = new SVG.Rectangle();
                            visual.Position = r.TopLeft;
                            visual.Width = 7;
                            visual.Height = 7;
                            visual.Background = "DimGray";

                            this.map[x.toString() + y.toString()] = visual;
                            g.Append(visual);
                        }
                    }
                }
                g.Position = this.rectangle.TopLeft;
                g.IsVisible = true;
                this.text = new SVG.TextBlock();
                this.text.FontSize = 10;
                this.text.Position = new Point(0, this.rectangle.Height + 20);
                this.text.Text = "Width: " + this.rectangle.Width + ", Height: " + this.rectangle.Height;
                g.Append(this.text);
                this.visual = g;
            }

            private updateVisual() {
                for (var x = -1; x <= +1; x++) {
                    for (var y = -1; y <= +1; y++) {
                        if ((x != 0) || (y != 0)) {
                            var v = this.map[x.toString() + y.toString()];
                            var r = this.GetHandleBounds(new Point(x, y));
                            v.Position = r.TopLeft;
                        }
                    }
                }
                this.text.Position = new Point(0, this.rectangle.Height + 20);
                this.text.Text = "Width: " + this.rectangle.Width + ", Height: " + this.rectangle.Height;
                this.visual.Position = this.rectangle.TopLeft;
            }

            public HitTest(point: Point): Point {
                // (0, 0) element, (-1, -1) top-left, (+1, +1) bottom-right
                if (this.isresizable) {
                    for (var x = -1; x <= +1; x++) {
                        for (var y = -1; y <= +1; y++) {
                            if ((x != 0) || (y != 0)) {
                                var hit = new Point(x, y);
                                var r = this.GetHandleBounds(hit);//local coordinates
                                r.Offset(this.rectangle.X, this.rectangle.Y);
                                if (r.Contains(point)) return hit;
                            }
                        }
                    }
                }

                if (this.rectangle.Contains(point)) return new Point(0, 0);
                return new Point(-2, -2);
            }

            public GetHandleBounds(p: Point): Rect {
                var r = new Rect(0, 0, 7, 7);
                if (p.X < 0) {
                    r.X = -7;
                }
                if (p.X === 0) {
                    r.X = Math.floor(this.rectangle.Width / 2) - 3;
                }
                if (p.X > 0) {
                    r.X = this.rectangle.Width + 1.0;
                }
                if (p.Y < 0) {
                    r.Y = -7;
                }
                if (p.Y === 0) {
                    r.Y = Math.floor(this.rectangle.Height / 2) - 3;
                }
                if (p.Y > 0) {
                    r.Y = this.rectangle.Height + 1.0;
                }
                return r;
            }

            public GetCursor(point: Point): string {
                var hit = this.HitTest(point);
                if ((hit.X === 0) && (hit.Y === 0)) return (this.isManipulating) ? Cursors.MoveTo : Cursors.select;
                if ((hit.X >= -1) && (hit.X <= +1) && (hit.Y >= -1) && (hit.Y <= +1) && this.isresizable) {
                    if (hit.X === -1 && hit.Y === -1) {
                        return "nw-resize";
                    }
                    if (hit.X === +1 && hit.Y === +1) {
                        return "se-resize";
                    }
                    if (hit.X === -1 && hit.Y === +1) {
                        return "sw-resize";
                    }
                    if (hit.X === +1 && hit.Y === -1) {
                        return "ne-resize";
                    }
                    if (hit.X === 0 && hit.Y === -1) {
                        return "n-resize";
                    }
                    if (hit.X === 0 && hit.Y === +1) {
                        return "s-resize";
                    }
                    if (hit.X === +1 && hit.Y === 0) {
                        return "e-resize";
                    }
                    if (hit.X === -1 && hit.Y === 0) {
                        return "w-resize";
                    }
                }
                return null;
            }

            public Start(point: Point, handle: Point) {
                if ((handle.X >= -1) && (handle.X <= +1) && (handle.Y >= -1) && (handle.Y <= +1)) {
                    this.currentHandle = handle;
                    this.initialState = this.rectangle;
                    this.finalState = null;
                    this.currentPoint = point;
                    this.isManipulating = true;
                }
            }

            public Stop() {
                this.finalState = this.rectangle;
                this.isManipulating = false;
            }

            public get IsManipulation(): boolean {
                return this.isManipulating;
            }

            public MoveTo(p: Point) {
                var h = this.currentHandle;
                var a = Point.Empty;
                var b = Point.Empty;
                if ((h.X == -1) || ((h.X === 0) && (h.Y === 0))) {
                    a.X = p.X - this.currentPoint.X;
                }
                if ((h.Y == -1) || ((h.X === 0) && (h.Y === 0))) {
                    a.Y = p.Y - this.currentPoint.Y;
                }
                if ((h.X == +1) || ((h.X === 0) && (h.Y === 0))) {
                    b.X = p.X - this.currentPoint.X;
                }
                if ((h.Y == +1) || ((h.X === 0) && (h.Y === 0))) {
                    b.Y = p.Y - this.currentPoint.Y;
                }
                var tl = this.rectangle.TopLeft;
                var br = new Point(this.rectangle.X + this.rectangle.Width, this.rectangle.Y + this.rectangle.Height);
                tl.X += a.X;
                tl.Y += a.Y;
                br.X += b.X;
                br.Y += b.Y;
                //if (a.X != 0 || a.Y != 0) console.log("a: (" + a.X + "," + a.Y + ")");
                //if (b.X != 0 || b.Y != 0) console.log("b: (" + b.X + "," + b.Y + ")");

                //cut-off
                if (Math.abs(br.X - tl.X) <= 4 || Math.abs(br.Y - tl.Y) <= 4) return;
                this.rectangle.X = tl.X;
                this.rectangle.Y = tl.Y;
                this.rectangle.Width = Math.floor(br.X - tl.X);
                this.rectangle.Height = Math.floor(br.Y - tl.Y);
                this.currentPoint = p;
                this.updateVisual();
            }

            public UpdateRectangle(r: Rect) {
                this.rectangle = r.Clone();
                this.updateVisual();
            }

            public paint(context: Canvas) {

            }
        }

        /**
         * The service handling the undo-redo stack.
         */
        export class Selector {
            private startPoint: Point;
            private currentPoint: Point;
            private visual: SVG.Rectangle;
            private diagram: DiagramSurface;
            public IsActive: boolean = false;

            public get Visual(): SVG.Rectangle {
                return this.visual;
            }

            constructor(diagram: DiagramSurface) {
                this.visual = new SVG.Rectangle();
                //this.visual.Background = "#778899";
                this.visual.Stroke = "#778899";
                this.visual.StrokeThickness = 1;
                this.visual.StrokeDash = "2,2";
                this.visual.Opacity = 0.0;
                this.diagram = diagram;
                //this.visual.IsVisible = false;
            }

            public Start(startPoint: Point) {
                this.startPoint = startPoint;
                this.currentPoint = startPoint;
                this.visual.IsVisible = true;
                this.visual.Position = startPoint;
                this.diagram.MainLayer.Append(this.visual);
                this.IsActive = true;
                //console.log(this.startPoint.toString());
            }

            public End() {
                if (!this.IsActive) return;
                //console.log(this.currentPoint.toString());
                this.startPoint = null;
                this.currentPoint = null;
                this.visual.IsVisible = false;
                this.diagram.MainLayer.Remove(this.visual);
                this.IsActive = false;
            }

            public get Rectangle(): Rect {
                var r = new Rect(
                    (this.startPoint.X <= this.currentPoint.X) ? this.startPoint.X : this.currentPoint.X,
                    (this.startPoint.Y <= this.currentPoint.Y) ? this.startPoint.Y : this.currentPoint.Y,
                    this.currentPoint.X - this.startPoint.X,
                    this.currentPoint.Y - this.startPoint.Y);
                if (r.Width < 0) r.Width *= -1;
                if (r.Height < 0) r.Height *= -1;
                return r;
            }

            public updateCurrentPoint(p: Point) {
                this.currentPoint = p;
            }

            public paint(context: Canvas) {
                var r = this.Rectangle;
                this.visual.Position = r.TopLeft;
                this.visual.Width = r.Width + 1;
                this.visual.Height = r.Height + 1;
            }
        }

        /**
         * Defines a standard shape template with four connectors.
         */
        export class ShapeTemplateBase implements IShapeTemplate {
            public IsResizable = true;
            public DefaultContent = "";
            public Geometry: string;
            public Stroke: string;
            public StrokeThickness: number;
            public Background: string;
            public Id: string;
            public Width: number;
            public Height: number;
            public Rotation: number;
            public Position: Point;
            public CornerRadius: number;
            public Opacity: number;
            public static DefaultConnectorTemplates =
            [
                {
                    Name: "Top",
                    Type: "Data [in]",
                    Description: "Top Connector",
                    GetConnectorPosition: function (parent) {
                        return new Point(Math.floor(parent.Rectangle.Width / 2), 0);
                    },
                    CanConnectTo: function (other: Connector) {
                        return other.Template.Name == "Top";
                    }
                },
                {
                    Name: "Right",
                    Type: "Data [in]",
                    Description: "Right Connector",
                    GetConnectorPosition: function (parent) {
                        return new Point(Math.floor(parent.Rectangle.Width), Math.floor(parent.Rectangle.Height / 2));
                    },
                    CanConnectTo: function (other: Connector) {
                        return other.Template.Name == "Left";
                    }
                },
                {
                    Name: "Bottom",
                    Type: "Data [out] [array]",
                    Description: "Bottom Connector",
                    GetConnectorPosition: function (parent) {
                        return new Point(Math.floor(parent.Rectangle.Width / 2), parent.Rectangle.Height);
                    },
                    CanConnectTo: function (other) {
                        return other.Template.Name == "Bottom";
                    }
                },
                {
                    Name: "Left",
                    Type: "Data [in]",
                    Description: "Left Connector",
                    GetConnectorPosition: function (parent) {
                        return new Point(0, Math.floor(parent.Rectangle.Height / 2));
                    },
                    CanConnectTo: function (other: Connector) {
                        return other.Template.Name == "Right";
                    }
                }
            ];
            public ConnectorTemplates = ShapeTemplateBase.DefaultConnectorTemplates;

            public Edit(element: Shape, canvas: Canvas, point: Point) {
                // will do later on
            }

            constructor(id: string = null) {
                this.Id = id;
                this.Width = 150;
                this.Height = 80;
                this.Position = Point.Empty;
                this.Stroke = "Silver";
                this.StrokeThickness = 0;
                this.Background = "#1e90ff";
            }

            public Clone(): ShapeTemplateBase {
                var clone = new ShapeTemplateBase();
                clone.Id = this.Id;
                clone.Width = this.Width;
                clone.Height = this.Height;
                clone.Position = this.Position;
                clone.Background = this.Background;
                return clone;
            }
        }

        /**
         * A collection of pre-defined shapes.
         */
        export class Shapes {
            static get Rectangle() {
                var shape = new ShapeTemplateBase();
                shape.Geometry = "Rectangle";
                return shape;
            }

            static get Triangle() {
                var shape = new ShapeTemplateBase();
                shape.Geometry = "m2.5,109.24985l61,-106.74985l61,106.74985l-122,0z";
                return shape;
            }

            static get SequentialData() {
                var shape = new ShapeTemplateBase();
                shape.Geometry = "m50.21875,97.4375l0,0c-26.35457,0 -47.71875,-21.25185 -47.71875,-47.46875l0,0c0,-26.21678 21.36418,-47.46875 47.71875,-47.46875l0,0c12.65584,0 24.79359,5.00155 33.74218,13.90339c8.94862,8.90154 13.97657,20.97617 13.97657,33.56536l0,0c0,12.58895 -5.02795,24.66367 -13.97657,33.56542l13.97657,0l0,13.90333l-47.71875,0z";
                return shape;
            }

            static get Data() {
                var shape = new ShapeTemplateBase();
                shape.Geometry = "m2.5,97.70305l19.07013,-95.20305l76.27361,0l-19.0702,95.20305l-76.27354,0z";
                return shape;
            }

            static get Wave() {
                var shape = new ShapeTemplateBase();
                shape.Geometry = "m2.5,15.5967c31.68356,-45.3672 63.37309,45.3642 95.05661,0l0,81.65914c-31.68353,45.36404 -63.37305,-45.36732 -95.05661,0l0,-81.65914z";
                return shape;
            }

        }

        /**
         * Node types used when parsing XML.
         */
        export enum NodeTypes {
            ElementNode = 1,
            AttributeNode = 2,
            TextNode = 3,
            CDataNode = 4,
            EntityReferenceNode = 5,
            EntityNode = 6,
            ProcessingInstructionNode = 7,
            CommentNode = 8,
            DocumentNode = 9,
            DocumentTypeNode = 10,
            DocumentFragmentNode = 11,
            NotationNode = 12,
        }


    }
}