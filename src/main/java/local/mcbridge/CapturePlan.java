package local.mcbridge;

/** Bounded sampling schedule. Missing render slots are skipped, never duplicated. */
public record CapturePlan(int width, int height, int fps, int durationMs, int count) {
    public static CapturePlan of(int width, int height, int fps, int durationMs, boolean single) {
        if(width<640 || width>3840 || height<360 || height>2160)
            throw new IllegalArgumentException("Resolution must be 640..3840 by 360..2160");
        if(fps<1 || fps>30 || durationMs<100 || durationMs>10000)
            throw new IllegalArgumentException("fps must be 1..30; durationMs must be 100..10000");
        int count=single?1:(int)Math.ceil((long)durationMs*fps/1000.0);
        if(count>120 || (long)count*width*height>250_000_000L)
            throw new IllegalArgumentException("Capture exceeds 120 frames or 250 million total pixels; lower fps, duration or resolution");
        return new CapturePlan(width,height,fps,durationMs,count);
    }
    public int slot(long elapsedNs) {return (int)(elapsedNs*fps/1_000_000_000L);}
    public double scheduledMs(int slot) {return slot*1000.0/fps;}
}
