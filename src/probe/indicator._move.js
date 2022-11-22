
		if ( this.scroller.options.probeType == 1 && timestamp - this.startTime > 300 ) {
			this.startTime = timestamp;
			this.scroller._execEvent('scroll', e);
		} else if ( this.scroller.options.probeType > 1 ) {
			this.scroller._execEvent('scroll', e);
		}
