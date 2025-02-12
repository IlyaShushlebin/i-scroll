
function IScroll (el, options) {
	this.wrapper = typeof el == 'string' ? document.querySelector(el) : el;
	this.scroller = this.wrapper.children[0];
	this.scrollerStyle = this.scroller.style;		// cache style for better performance

	this.options = {

// INSERT POINT: OPTIONS
		disablePointer : !utils.hasPointer,
		disableTouch : utils.hasPointer || !utils.hasTouch,
		disableMouse : utils.hasPointer || utils.hasTouch,
		startX: 0,
		startY: 0,
		scrollY: true,
		directionLockThreshold: 5,
		momentum: true,

		bounce: true,
		bounceDeltaScale: 3,
		zeroXBounceLock: false,
		maxXBounceLock: false,
		zeroYBounceLock: false,
		maxYBounceLock: false,
		resetPositionForOutside: true,
		bounceLock: false,
		bounceTime: 600,
		bounceEasing: '',

		preventDefault: true,
		preventDefaultException: { tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT)$/ },
		preventNativeScrollTab: true,
		preventScrollTimeoutTime: 1000,

		useScrollableElements: false,
		scrollableElementTest: { className: /^(scrollable)$/ },

		HWCompositing: true,
		useTransition: true,
		useTransform: true,
		bindToWrapper: typeof window.onmousedown === "undefined"
	};

	for ( var i in options ) {
		this.options[i] = options[i];
	}

	// Normalize options
	this.translateZ = this.options.HWCompositing && utils.hasPerspective ? ' translateZ(0)' : '';

	this.options.useTransition = utils.hasTransition && this.options.useTransition;
	this.options.useTransform = utils.hasTransform && this.options.useTransform;

	this.options.eventPassthrough = this.options.eventPassthrough === true ? 'vertical' : this.options.eventPassthrough;
	this.options.preventDefault = !this.options.eventPassthrough && this.options.preventDefault;

	// If you want eventPassthrough I have to lock one of the axes
	this.options.scrollY = this.options.eventPassthrough == 'vertical' ? false : this.options.scrollY;
	this.options.scrollX = this.options.eventPassthrough == 'horizontal' ? false : this.options.scrollX;

	// With eventPassthrough we also need lockDirection mechanism
	this.options.freeScroll = this.options.freeScroll && !this.options.eventPassthrough;
	this.options.directionLockThreshold = this.options.eventPassthrough ? 0 : this.options.directionLockThreshold;

	this.options.bounceEasing = typeof this.options.bounceEasing == 'string' ? utils.ease[this.options.bounceEasing] || utils.ease.circular : this.options.bounceEasing;

	this.options.resizePolling = this.options.resizePolling === undefined ? 60 : this.options.resizePolling;

	if ( this.options.tap === true ) {
		this.options.tap = 'tap';
	}

	// https://github.com/cubiq/iscroll/issues/1029
	if (!this.options.useTransition && !this.options.useTransform) {
		if(!(/relative|absolute/i).test(this.scrollerStyle.position)) {
			this.scrollerStyle.position = "relative";
		}
	}

// INSERT POINT: NORMALIZATION

	// Some defaults
	this.x = 0;
	this.y = 0;
	this.directionX = 0;
	this.directionY = 0;
	this._events = {};

// INSERT POINT: DEFAULTS

	this._init();
	this.refresh();

	this.scrollTo(this.options.startX, this.options.startY);
	this.enable();
}

IScroll.prototype = {
	version: '/* VERSION */',

	_init: function () {
		this._initEvents();

// INSERT POINT: _init

	},

	destroy: function () {
		this._initEvents(true);
		clearTimeout(this.resizeTimeout);
		this.resizeTimeout = null;
		this._execEvent('destroy');
	},

	_transitionEnd: function (e) {
		if (e.target != this.scroller || !this.isInTransition) {
			return;
		}

		this._transitionTime();
		if (!this.resetPosition(this.options.bounceTime)) {
			this.isInTransition = false;
			this._execEvent('scrollEnd', e);
		}
	},

	_start: function (e) {
		// React to left mouse button only
		if (utils.eventType[e.type] != 1) {
			// for button property
			// http://unixpapa.com/js/mouse.html
			var button;
			if (!e.which) {
				/* IE case */
				button = (e.button < 2) ? 0 :
					((e.button == 4) ? 1 : 2);
			} else {
				/* All others */
				button = e.button;
			}
			if (button !== 0) {
				return;
			}
		}

		if (!this.enabled || (this.initiated && utils.eventType[e.type] !== this.initiated)) {
			return;
		}

		if (this.options.useScrollableElements && !utils.preventDefaultException(e.target, this.options.scrollableElementTest)) {
			return;
		}

		if (this.options.preventDefault && !utils.isBadAndroid && !utils.preventDefaultException(e.target, this.options.preventDefaultException)) {
			e.preventDefault();
		}

		var point = e.touches ? e.touches[0] : e,
			pos;

		this.initiated = utils.eventType[e.type];
		this.moved = false;
		this.distX = 0;
		this.distY = 0;
		this.directionX = 0;
		this.directionY = 0;
		this.directionLocked = 0;

		this.startTime = utils.getTime();

		if (this.options.useTransition && this.isInTransition) {
			this._transitionTime();
			this.isInTransition = false;
			pos = this.getComputedPosition();
			this._translate(Math.round(pos.x), Math.round(pos.y));
			this._execEvent('scrollEnd', e);
		} else if (!this.options.useTransition && this.isAnimating) {
			this.isAnimating = false;
			this._execEvent('scrollEnd', e);
		}

		this.startX = this.x;
		this.startY = this.y;
		this.absStartX = this.x;
		this.absStartY = this.y;
		this.pointX = point.pageX;
		this.pointY = point.pageY;

		this._execEvent('beforeScrollStart', e);
	},

	_move: function (e) {
		if (!this.enabled || utils.eventType[e.type] !== this.initiated) {
			return;
		}

		if (this.options.preventDefault) {	// increases performance on Android? TODO: check!
			e.preventDefault();
		}

		var point = e.touches ? e.touches[0] : e,
			deltaX = point.pageX - this.pointX,
			deltaY = point.pageY - this.pointY,
			timestamp = utils.getTime(),
			newX, newY,
			absDistX, absDistY;

		this.pointX = point.pageX;
		this.pointY = point.pageY;

		this.distX += deltaX;
		this.distY += deltaY;
		absDistX = Math.abs(this.distX);
		absDistY = Math.abs(this.distY);

		// We need to move at least 10 pixels for the scrolling to initiate
		if (timestamp - this.endTime > 300 && (absDistX < 10 && absDistY < 10)) {
			return;
		}

		// If you are scrolling in one direction lock the other
		if (!this.directionLocked && !this.options.freeScroll) {
			if (absDistX > absDistY + this.options.directionLockThreshold) {
				this.directionLocked = 'h';		// lock horizontally
			} else if (absDistY >= absDistX + this.options.directionLockThreshold) {
				this.directionLocked = 'v';		// lock vertically
			} else {
				this.directionLocked = 'n';		// no lock
			}
		}

		if (this.directionLocked == 'h') {
			if (this.options.eventPassthrough == 'vertical') {
				e.preventDefault();
			} else if (this.options.eventPassthrough == 'horizontal') {
				this.initiated = false;
				return;
			}

			deltaY = 0;
		} else if (this.directionLocked == 'v') {
			if (this.options.eventPassthrough == 'horizontal') {
				e.preventDefault();
			} else if (this.options.eventPassthrough == 'vertical') {
				this.initiated = false;
				return;
			}

			deltaX = 0;
		}

		deltaX = this.hasHorizontalScroll ? deltaX : 0;
		deltaY = this.hasVerticalScroll ? deltaY : 0;

		newX = this.x + deltaX;
		newY = this.y + deltaY;

		// Slow down if outside of the boundaries
		if (newX > 0) {
			if (this.options.bounce && !this.options.zeroXBounceLock) {
				newX = this.x + deltaX / this.options.bounceDeltaScale;
			} else {
				newX = 0;
			}
		}

		if (newX < this.maxScrollX) {
			if (this.options.bounce && !this.options.maxXBounceLock) {
				newX = this.x + deltaX / this.options.bounceDeltaScale;
			} else {
				newX = this.maxScrollX;
			}
		}

		if (newY > 0) {
			if (this.options.bounce && !this.options.zeroYBounceLock) {
				newY = this.y + deltaY / this.options.bounceDeltaScale;
			} else {
				newY = 0;
			}
		}

		if (newY < this.maxScrollY) {
			if (this.options.bounce && !this.options.maxYBounceLock) {
				newY = this.y + deltaY / this.options.bounceDeltaScale;
			} else {
				newY = this.maxScrollY;
			}
		}

		this.directionX = deltaX > 0 ? -1 : deltaX < 0 ? 1 : 0;
		this.directionY = deltaY > 0 ? -1 : deltaY < 0 ? 1 : 0;

		if (!this.moved) {
			this._execEvent('scrollStart', e);
		}

		this.moved = true;

		this._translate(newX, newY);

		/* REPLACE START: _move */

		if (timestamp - this.startTime > 300) {
			this.startTime = timestamp;
			this.startX = this.x;
			this.startY = this.y;
		}

		/* REPLACE END: _move */

	},

	_end: function (e) {
		if (!this.enabled || utils.eventType[e.type] !== this.initiated) {
			return;
		}

		if (this.options.preventDefault && !utils.preventDefaultException(e.target, this.options.preventDefaultException)) {
			e.preventDefault();
		}

		var point = e.changedTouches ? e.changedTouches[0] : e,
			momentumX,
			momentumY,
			duration = (utils.getTime() - this.startTime) || 1,
			newX = Math.round(this.x),
			newY = Math.round(this.y),
			distanceX = Math.abs(newX - this.startX),
			distanceY = Math.abs(newY - this.startY),
			time = 0,
			easing = '';

		this.isInTransition = 0;
		this.initiated = 0;
		this.endTime = utils.getTime();

		// reset if we are outside of the boundaries
		if (this.options.resetPositionForOutside && this.resetPosition(this.options.bounceTime)) {
			return;
		}

		this.scrollTo(newX, newY);	// ensures that the last position is rounded

		// we scrolled less than 10 pixels
		if (!this.moved) {
			if (this.options.tap) {
				utils.tap(e, this.options.tap);
			}

			if (this.options.click) {
				utils.click(e);
			}

			this._execEvent('scrollCancel', e);
			return;
		}

		if (this._events.flick && duration < 200 && distanceX < 100 && distanceY < 100) {
			this._execEvent('flick', e);
			return;
		}

		// start momentum animation if needed
		if (this.options.momentum && duration < 300) {
			momentumX = this.hasHorizontalScroll ? utils.momentum(this.x, this.startX, duration, this.maxScrollX, this.options.bounce ? this.wrapperWidth : 0, this.options.deceleration) : {
				destination: newX,
				duration: 0
			};
			momentumY = this.hasVerticalScroll ? utils.momentum(this.y, this.startY, duration, this.maxScrollY, this.options.bounce ? this.wrapperHeight : 0, this.options.deceleration) : {
				destination: newY,
				duration: 0
			};
			newX = momentumX.destination;
			newY = momentumY.destination;
			time = Math.max(momentumX.duration, momentumY.duration);
			this.isInTransition = 1;
		}

// INSERT POINT: _end

		if (newX != this.x || newY != this.y) {
			// change easing function when scroller goes out of the boundaries
			if (newX > 0 || newX < this.maxScrollX || newY > 0 || newY < this.maxScrollY) {
				easing = utils.ease.quadratic;
			}

			this.scrollTo(newX, newY, time, easing);
			return;
		}

		this._execEvent('scrollEnd', e);
	},

	_resize: function () {
		var that = this;

		clearTimeout(this.resizeTimeout);

		this.resizeTimeout = setTimeout(function () {
			that.refresh();
		}, this.options.resizePolling);
	},

	resetPosition: function (time) {
		var x = this.x,
			y = this.y;

		time = time || 0;

		if (!this.hasHorizontalScroll || this.x > 0) {
			x = 0;
		} else if (this.x < this.maxScrollX) {
			x = this.maxScrollX;
		}

		if (!this.hasVerticalScroll || this.y > 0) {
			y = 0;
		} else if (this.y < this.maxScrollY) {
			y = this.maxScrollY;
		}

		if (x == this.x && y == this.y) {
			return false;
		}

		this.scrollTo(x, y, time, this.options.bounceEasing);
		this._execEvent('reset');
		return true;
	},

	disable: function () {
		this.enabled = false;
	},

	enable: function () {
		this.enabled = true;
	},

	refresh: function () {
		utils.getRect(this.wrapper);		// Force reflow

		this.wrapperWidth = this.wrapper.clientWidth;
		this.wrapperHeight = this.wrapper.clientHeight;

		var rect = utils.getRect(this.scroller);
		/* REPLACE START: refresh */

		this.scrollerWidth = rect.width;
		this.scrollerHeight = rect.height;

		this.maxScrollX = this.wrapperWidth - this.scrollerWidth;
		this.maxScrollY = this.wrapperHeight - this.scrollerHeight;

		/* REPLACE END: refresh */

		this.hasHorizontalScroll = this.options.scrollX && this.maxScrollX < 0;
		this.hasVerticalScroll = this.options.scrollY && this.maxScrollY < 0;

		if (!this.hasHorizontalScroll) {
			this.maxScrollX = 0;
			this.scrollerWidth = this.wrapperWidth;
		}

		if (!this.hasVerticalScroll) {
			this.maxScrollY = 0;
			this.scrollerHeight = this.wrapperHeight;
		}

		this.hasVerticalScroll = this.hasVerticalScroll || this.options.bounceLock;

		this.endTime = 0;
		this.directionX = 0;
		this.directionY = 0;

		if (utils.hasPointer && !this.options.disablePointer) {
			// The wrapper should have `touchAction` property for using pointerEvent.
			this.wrapper.style[utils.style.touchAction] = utils.getTouchAction(this.options.eventPassthrough, true);

			// case. not support 'pinch-zoom'
			// https://github.com/cubiq/iscroll/issues/1118#issuecomment-270057583
			if (!this.wrapper.style[utils.style.touchAction]) {
				this.wrapper.style[utils.style.touchAction] = utils.getTouchAction(this.options.eventPassthrough, false);
			}
		}
		this.wrapperOffset = utils.offset(this.wrapper);

		this._execEvent('refresh');

		this.resetPosition();

// INSERT POINT: _refresh

	},

	on: function (type, fn) {
		if (!this._events[type]) {
			this._events[type] = [];
		}

		this._events[type].push(fn);
	},

	off: function (type, fn) {
		if (!this._events[type]) {
			return;
		}

		var index = this._events[type].indexOf(fn);

		if (index > -1) {
			this._events[type].splice(index, 1);
		}
	},

	_execEvent: function (type, event) {
		if (!this._events[type]) {
			return;
		}

		var i = 0,
			l = this._events[type].length;

		if (!l) {
			return;
		}

		for (; i < l; i++) {
			this._events[type][i].apply(this, [].slice.call(arguments, 1).concat(event));
		}
	},

	scrollBy: function (x, y, time, easing) {
		x = this.x + x;
		y = this.y + y;
		time = time || 0;

		this.scrollTo(x, y, time, easing);
	},

	scrollTo: function (x, y, time, easing) {
		easing = easing || utils.ease.circular;

		this.isInTransition = this.options.useTransition && time > 0;
		var transitionType = this.options.useTransition && easing.style;
		if (!time || transitionType) {
			if (transitionType) {
				this._transitionTimingFunction(easing.style);
				this._transitionTime(time);
			}
			this._translate(x, y);
		} else {
			this._animate(x, y, time, easing.fn);
		}
	},

	scrollToElement: function (el, time, offsetX, offsetY, easing) {
		el = el.nodeType ? el : this.scroller.querySelector(el);

		if (!el) {
			return;
		}

		var pos = utils.offset(el);

		pos.left -= this.wrapperOffset.left;
		pos.top -= this.wrapperOffset.top;

		// if offsetX/Y are true we center the element to the screen
		var elRect = utils.getRect(el);
		var wrapperRect = utils.getRect(this.wrapper);
		if (offsetX === true) {
			offsetX = Math.round(elRect.width / 2 - wrapperRect.width / 2);
		}
		if (offsetY === true) {
			offsetY = Math.round(elRect.height / 2 - wrapperRect.height / 2);
		}

		pos.left -= offsetX || 0;
		pos.top -= offsetY || 0;

		pos.left = pos.left > 0 ? 0 : pos.left < this.maxScrollX ? this.maxScrollX : pos.left;
		pos.top = pos.top > 0 ? 0 : pos.top < this.maxScrollY ? this.maxScrollY : pos.top;

		time = time === undefined || time === null || time === 'auto' ? Math.max(Math.abs(this.x - pos.left), Math.abs(this.y - pos.top)) : time;

		this.scrollTo(pos.left, pos.top, time, easing);
	},

	_transitionTime: function (time) {
		if (!this.options.useTransition) {
			return;
		}
		time = time || 0;
		var durationProp = utils.style.transitionDuration;
		if (!durationProp) {
			return;
		}

		this.scrollerStyle[durationProp] = time + 'ms';

		if (!time && utils.isBadAndroid) {
			this.scrollerStyle[durationProp] = '0.0001ms';
			// remove 0.0001ms
			var self = this;
			rAF(function () {
				if (self.scrollerStyle[durationProp] === '0.0001ms') {
					self.scrollerStyle[durationProp] = '0s';
				}
			});
		}

// INSERT POINT: _transitionTime

	},

	_transitionTimingFunction: function (easing) {
		this.scrollerStyle[utils.style.transitionTimingFunction] = easing;

// INSERT POINT: _transitionTimingFunction

	},

	_translate: function (x, y) {
		if (this.options.useTransform) {

			/* REPLACE START: _translate */

			this.scrollerStyle[utils.style.transform] = 'translate(' + x + 'px,' + y + 'px)' + this.translateZ;

			/* REPLACE END: _translate */

		} else {
			x = Math.round(x);
			y = Math.round(y);
			this.scrollerStyle.left = x + 'px';
			this.scrollerStyle.top = y + 'px';
		}

		this.x = x;
		this.y = y;

// INSERT POINT: _translate

	},

	_initEvents: function (remove) {
		var eventType = remove ? utils.removeEvent : utils.addEvent,
			target = this.options.bindToWrapper ? this.wrapper : window;

		eventType(window, 'orientationchange', this);
		eventType(window, 'resize', this);

		if (this.options.click) {
			eventType(this.wrapper, 'click', this, true);
		}

		if (!this.options.disableMouse) {
			eventType(this.wrapper, 'mousedown', this);
			eventType(target, 'mousemove', this);
			eventType(target, 'mousecancel', this);
			eventType(target, 'mouseup', this);
		}

		if (utils.hasPointer && !this.options.disablePointer) {
			eventType(this.wrapper, utils.prefixPointerEvent('pointerdown'), this);
			eventType(target, utils.prefixPointerEvent('pointermove'), this);
			eventType(target, utils.prefixPointerEvent('pointercancel'), this);
			eventType(target, utils.prefixPointerEvent('pointerup'), this);
		}

		if (utils.hasTouch && !this.options.disableTouch) {
			eventType(this.wrapper, 'touchstart', this);
			eventType(target, 'touchmove', this);
			eventType(target, 'touchcancel', this);
			eventType(target, 'touchend', this);
		}

		eventType(this.scroller, 'transitionend', this);
		eventType(this.scroller, 'webkitTransitionEnd', this);
		eventType(this.scroller, 'oTransitionEnd', this);
		eventType(this.scroller, 'MSTransitionEnd', this);

		// https://github.com/cubiq/iscroll/issues/603
		if (this.options.preventNativeScrollTab) {
			this.preventScrollLocked = false;
			this.preventScrollTimeout = null;

			eventType(this.wrapper, 'scroll', this._preventScrollBug.bind(this));
			eventType(this.wrapper, 'keyup', this._scrollTab.bind(this), true);
		}
	},

	getComputedPosition: function () {
		var matrix = window.getComputedStyle(this.scroller, null),
			x, y;

		if (this.options.useTransform) {
			matrix = matrix[utils.style.transform].split(')')[0].split(', ');
			x = +(matrix[12] || matrix[4]);
			y = +(matrix[13] || matrix[5]);
		} else {
			x = +matrix.left.replace(/[^-\d.]/g, '');
			y = +matrix.top.replace(/[^-\d.]/g, '');
		}

		return {x: x, y: y};
	},

	_isDescendant: function (parent, child) {
		var node = child.parentNode;
		while (node != null) {
			if (node == parent) {
				return true;
			}
			node = node.parentNode;
		}
		return false;
	},

	_preventScrollBug: function () {
		var holder = this;
		if (true === holder.preventScrollLocked) {
			return false;
		}
		holder.preventScrollLocked = true;

		var element = document.activeElement;
		if (!this._isDescendant(holder.wrapper, element)) return false;

		var topPosition = holder.y;

		holder.scrollTo(holder.maxScrollX, holder.maxScrollY);
		setTimeout(function () {
			holder.scrollTo(0, topPosition);
		}, 1);
		setTimeout(function () {
			if (element != null && element !== document.body) holder.scrollToElement(element, null, null, true);
		}, 2);

		clearTimeout(holder.preventScrollTimeout);
		holder.preventScrollTimeout = setTimeout(function () {
			holder.preventScrollLocked = false;
		}, holder.options.preventScrollTimeoutTime);
	},

	_scrollTab: function (e) {
		var holder = this;
		var keyCode = e.keyCode || e.which;
		if (keyCode == 9) {
			var element = document.activeElement;
			if (!this._isDescendant(holder.wrapper, element)) return false;
			setTimeout(function () {
				if (element != null && element !== document.body) holder.scrollToElement(element, null, null, true);
			}, 2);
		}
	},

