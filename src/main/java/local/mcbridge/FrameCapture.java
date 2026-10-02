package local.mcbridge;

import com.google.gson.*;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import org.lwjgl.sdl.SDLVideo;
import org.lwjgl.sdl.SDLError;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Owns one rendering-size lease. Only the render/game thread mutates session state. */
public final class FrameCapture {
    private static final Gson JSON=new GsonBuilder().serializeNulls().setPrettyPrinting().create();
    private static final Queue<Runnable> COMPLETIONS=new ConcurrentLinkedQueue<>();
    private static final ExecutorService WRITER=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"mcbridge-png");t.setDaemon(true);return t;});
    private static Session active;
    private static Path base;
    private static final class Session {
        final String id=UUID.randomUUID().toString(), createdAt=Instant.now().toString();
        final CapturePlan plan;
        final Path dir;
        final CompletableFuture<JsonObject> single;
        final int originalWidth,originalHeight,originalFps;
        final List<JsonObject> frames=new ArrayList<>();
        final long createdNs=System.nanoTime();
        long startNs,restoreNs;
        int stable,restoreStable,nextSlot,inFlight,skipped,busySkipped,failures;
        String state="preparing",endState="completed",reason="duration reached",error;
        boolean samplingDone,restoring;
        Session(CapturePlan plan, CompletableFuture<JsonObject> single, Minecraft mc) throws Exception {
            this.plan=plan;this.single=single;dir=base.resolve(id);
            originalWidth=mc.getWindow().getWidth();originalHeight=mc.getWindow().getHeight();
            originalFps=mc.options.framerateLimit().get();
            Files.createDirectories(dir);
        }
    }
    public static void init(Path gameDir) {base=gameDir.resolve("screenshots").resolve("captures");}

    public static JsonObject start(JsonObject args, CompletableFuture<JsonObject> single) throws Exception {
        if(active!=null)throw new IllegalStateException("A capture is active; wait for completion or stop it first");
        CapturePlan plan=CapturePlan.of(value(args,"width",1920),value(args,"height",1080),value(args,"fps",10),value(args,"durationMs",2000),single!=null);
        Minecraft mc=Minecraft.getInstance();
        Session s=new Session(plan,single,mc);active=s;
        try {
            persist(s);
            // Temporarily allow enough render opportunities; actual rates remain measured.
            mc.options.framerateLimit().set(Math.max(s.originalFps,Math.min(120,plan.fps()*2)));
            resize(mc,plan.width(),plan.height());
        } catch(Exception e) {fail(s,e);}
        return snapshot(s);
    }

    public static JsonObject status(String id) throws Exception {
        checkId(id);
        if(active!=null&&active.id.equals(id)) {persist(active);return snapshot(active);}
        Path file=base.resolve(id).resolve("manifest.json");
        if(!Files.isRegularFile(file))throw new IllegalArgumentException("Unknown capture id");
        return JsonParser.parseString(Files.readString(file)).getAsJsonObject();
    }
    public static JsonObject stop(String id) throws Exception {
        checkId(id);
        if(active==null||!active.id.equals(id))return status(id);
        active.samplingDone=true;active.endState="stopped";active.reason="requested";
        return snapshot(active);
    }
    public static JsonElement activeStatus() {return active==null?JsonNull.INSTANCE:obj("id",active.id,"state",active.state,"saved",active.frames.size(),"requested",active.plan.count());}

    public static void frame(long renderFrame,long tick) {
        drain();
        Session s=active;if(s==null)return;
        Minecraft mc=Minecraft.getInstance();long now=System.nanoTime();
        try {
            if(s.single!=null && s.single.isCancelled()) {s.samplingDone=true;s.endState="stopped";s.reason="screenshot request cancelled";}
            if(s.restoring) {
                if(sizeMatches(mc,s.originalWidth,s.originalHeight))s.restoreStable++;else s.restoreStable=0;
                if(s.restoreStable>=2)finish(s);
                else if(now-s.restoreNs>TimeUnit.SECONDS.toNanos(5)) {s.error="Original framebuffer size did not restore";s.endState="failed";finish(s);}
                return;
            }
            if(now-s.createdNs>TimeUnit.MILLISECONDS.toNanos(s.plan.durationMs()+15000L)) {
                fail(s,new TimeoutException("Capture/readback deadline exceeded"));restore(s,mc);return;
            }
            if(s.samplingDone) {if(s.inFlight==0)restore(s,mc);else s.state="saving";return;}
            if(s.state.equals("preparing")) {
                if(sizeMatches(mc,s.plan.width(),s.plan.height()))s.stable++;else s.stable=0;
                if(s.stable<2) {
                    if(now-s.createdNs>TimeUnit.SECONDS.toNanos(5))throw new IllegalStateException("Requested framebuffer resolution was not reached");
                    return;
                }
                s.state="recording";s.startNs=now;
            }
            if(!sizeMatches(mc,s.plan.width(),s.plan.height()))throw new IllegalStateException("Framebuffer changed during capture");
            long elapsed=now-s.startNs;
            if(s.single==null && elapsed>=TimeUnit.MILLISECONDS.toNanos(s.plan.durationMs())) {
                s.skipped+=s.plan.count()-s.nextSlot;s.nextSlot=s.plan.count();s.samplingDone=true;return;
            }
            int slot=s.single!=null?0:s.plan.slot(elapsed);
            if(slot>=s.plan.count()){s.samplingDone=true;return;}
            if(slot<s.nextSlot)return;
            s.skipped+=slot-s.nextSlot;s.nextSlot=slot+1;
            // Bound GPU readbacks and native PNG buffers to two full frames.
            if(s.inFlight>=2){s.busySkipped++;return;}
            take(s,mc,slot,elapsed,renderFrame,tick);
            if(s.nextSlot>=s.plan.count())s.samplingDone=true;
        } catch(Throwable e) {fail(s,e);}
    }

    private static void take(Session s,Minecraft mc,int slot,long elapsed,long renderFrame,long tick) {
        Path file=s.dir.resolve(String.format(Locale.ROOT,"frame-%04d.png",slot));
        JsonObject meta=obj("sampleIndex",slot,"path",file.toString(),"file",file.getFileName().toString(),"width",s.plan.width(),"height",s.plan.height(),"frame",renderFrame,"tick",tick,"capturedAt",Instant.now().toString(),"elapsedMs",elapsed/1_000_000.0,"scheduledMs",s.plan.scheduledMs(slot),"latenessMs",elapsed/1_000_000.0-s.plan.scheduledMs(slot));
        if(mc.player!=null)meta.add("player",obj("x",mc.player.getX(),"y",mc.player.getY(),"z",mc.player.getZ(),"yaw",mc.player.getYRot(),"pitch",mc.player.getXRot(),"usingItem",mc.player.isUsingItem(),"sneaking",mc.player.isShiftKeyDown()));
        s.inFlight++;
        try {
            Screenshot.takeScreenshot(mc.gameRenderer.mainRenderTarget(),image->{
                try {
                    if(image.getWidth()!=s.plan.width()||image.getHeight()!=s.plan.height())throw new IllegalStateException("Readback resolution changed");
                    WRITER.execute(()->{
                        Throwable error=null;
                        try(image){
                            if(image.format()!=com.mojang.blaze3d.platform.NativeImage.Format.RGBA)throw new IllegalStateException("Expected RGBA screenshot");
                            FastPng.write(image.getPixelBytes(),image.getWidth(),image.getHeight(),file);
                        }catch(Throwable e){error=e;}
                        Throwable result=error;
                        COMPLETIONS.add(()->{
                            s.inFlight--;
                            if(result!=null){s.failures++;fail(s,result);}
                            else {meta.addProperty("savedAt",Instant.now().toString());s.frames.add(meta);}
                        });
                    });
                } catch(Throwable e) {image.close();COMPLETIONS.add(()->{s.inFlight--;s.failures++;fail(s,e);});}
            });
        } catch(Throwable e) {s.inFlight--;s.failures++;fail(s,e);}
    }
    private static void restore(Session s,Minecraft mc) {
        s.restoring=true;s.state="restoring";s.restoreNs=System.nanoTime();
        mc.options.framerateLimit().set(s.originalFps);
        try {resize(mc,s.originalWidth,s.originalHeight);}catch(Exception e){s.error=e.getMessage();s.endState="failed";finish(s);}
    }
    private static void resize(Minecraft mc,int width,int height) {
        float density=mc.getWindow().getPixelDensity();
        int w=Math.round(width/density),h=Math.round(height/density);
        if(!SDLVideo.SDL_SetWindowSize(mc.getWindow().handle(),w,h))throw new IllegalStateException("SDL resize failed: "+SDLError.SDL_GetError());
    }
    private static boolean sizeMatches(Minecraft mc,int width,int height) {
        var target=mc.gameRenderer.mainRenderTarget();
        return target.width==width && target.height==height;
    }
    private static void fail(Session s,Throwable error) {
        s.error=String.valueOf(error.getMessage());s.endState="failed";s.reason="error";s.samplingDone=true;
    }
    private static void finish(Session s) {
        s.state=s.endState;
        try {persist(s);}catch(Exception e){s.state="failed";s.error="Manifest save failed: "+e.getMessage();}
        if(s.single!=null) {
            if(s.state.equals("completed")&&!s.frames.isEmpty()) {
                JsonObject result=s.frames.getFirst().deepCopy();result.addProperty("ok",true);result.addProperty("captureId",s.id);result.addProperty("manifestPath",s.dir.resolve("manifest.json").toString());result.addProperty("restored",true);s.single.complete(result);
            } else s.single.completeExceptionally(new IllegalStateException(s.error==null?s.reason:s.error));
        }
        active=null;
    }
    private static JsonObject snapshot(Session s) {
        List<JsonObject> ordered=new ArrayList<>(s.frames);ordered.sort(Comparator.comparingInt(f->f.get("sampleIndex").getAsInt()));
        double rate=0;
        if(ordered.size()>1){double span=ordered.getLast().get("elapsedMs").getAsDouble()-ordered.getFirst().get("elapsedMs").getAsDouble();if(span>0)rate=(ordered.size()-1)*1000/span;}
        JsonObject result=obj("ok",true,"id",s.id,"state",s.state,"terminal",Set.of("completed","stopped","failed","interrupted").contains(s.state),"directory",s.dir.toString(),"manifestPath",s.dir.resolve("manifest.json").toString(),"createdAt",s.createdAt,"updatedAt",Instant.now().toString(),"width",s.plan.width(),"height",s.plan.height(),"requestedFps",s.plan.fps(),"durationMs",s.plan.durationMs(),"requestedFrames",s.plan.count(),"savedFrames",ordered.size(),"inFlight",s.inFlight,"missedRenderSlots",s.skipped,"backpressureDrops",s.busySkipped,"writeFailures",s.failures,"unattemptedFrames",s.plan.count()-s.nextSlot,"observedFps",rate,"reason",s.reason,"error",s.error,"originalWidth",s.originalWidth,"originalHeight",s.originalHeight,"originalFps",s.originalFps);
        result.add("frames",JSON.toJsonTree(ordered));return result;
    }
    private static void persist(Session s) throws Exception {
        Path temp=s.dir.resolve("manifest.tmp");Files.writeString(temp,JSON.toJson(snapshot(s)));
        try {Files.move(temp,s.dir.resolve("manifest.json"),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
        catch(AtomicMoveNotSupportedException e){Files.move(temp,s.dir.resolve("manifest.json"),StandardCopyOption.REPLACE_EXISTING);}
    }
    public static void close() {
        WRITER.shutdown();
        try{WRITER.awaitTermination(3,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}
        drain();
        if(active!=null){Session s=active;s.state="interrupted";s.error="Client shutdown during capture";try{persist(s);}catch(Exception ignored){}if(s.single!=null)s.single.completeExceptionally(new IllegalStateException(s.error));active=null;}
    }
    private static void drain() {Runnable done;while((done=COMPLETIONS.poll())!=null)done.run();}
    private static void checkId(String id) {if(!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IllegalArgumentException("Invalid capture id");}
    private static int value(JsonObject o,String key,int fallback) {
        if(!o.has(key))return fallback;double n=o.get(key).getAsDouble();if(!Double.isFinite(n)||n!=Math.rint(n))throw new IllegalArgumentException("Integer required: "+key);return (int)n;
    }
    private static JsonObject obj(Object...pairs) {JsonObject o=new JsonObject();for(int i=0;i<pairs.length;i+=2)o.add(pairs[i].toString(),JSON.toJsonTree(pairs[i+1]));return o;}
}
