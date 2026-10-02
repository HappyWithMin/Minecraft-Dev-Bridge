package local.mcbridge;

import com.google.gson.*;
import local.mcbridge.mixin.ActionAccess;
import com.sun.net.httpserver.HttpServer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.*;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.player.ClientInput;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.player.Input;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.phys.Vec2;
import org.lwjgl.sdl.SDLVideo;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** All game state is accessed on the game thread; the HTTP worker only queues jobs. */
public class Bridge implements ClientModInitializer {
    private static final Gson JSON = new GsonBuilder().serializeNulls().create();
    private static final Queue<Job> JOBS = new ConcurrentLinkedQueue<>();
    private static final int MAX_PENDING = 64;
    private static boolean enabled;
    private static HttpServer server;
    private static ExecutorService workers;
    private static Path gameDir;
    private static long tick, frame, inputUntil;
    private static boolean forward, back, left, right, jump, sneak, sprint, use, attack;
    private static final RemoteInput INPUT = new RemoteInput();
    private record Job(JsonObject request, CompletableFuture<JsonObject> result, long deadline) {}

    @Override public void onInitializeClient() {
        // Installing this jar in a normal profile never enables automation implicitly.
        if (!Boolean.getBoolean("mcbridge.dedicated")) return;
        try {
            gameDir = FabricLoader.getInstance().getGameDir().toAbsolutePath();
            FrameCapture.init(gameDir);
            String token = Files.readString(gameDir.resolve("bridge-token.txt")).trim();
            if (token.length() < 32) throw new IllegalArgumentException("Bridge token must have at least 32 characters");
            int port = Integer.getInteger("mcbridge.port", 25580);
            HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 8);
            server=http;
            workers=Executors.newFixedThreadPool(4, r -> {Thread t = new Thread(r, "mcbridge-http"); t.setDaemon(true); return t;});
            http.setExecutor(workers);
            http.createContext("/rpc", ex -> {
                int code = 200;
                JsonObject result;
                try {
                    String auth = ex.getRequestHeaders().getFirst("Authorization");
                    if (auth == null || !MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8), ("Bearer " + token).getBytes(StandardCharsets.UTF_8))) {
                        code = 401; throw new IllegalArgumentException("Unauthorized");
                    }
                    if (ex.getRequestHeaders().getFirst("Origin") != null) {code=403; throw new IllegalArgumentException("Browser origins are not supported");}
                    if (!ex.getRequestMethod().equals("POST") || !ex.getRequestURI().getPath().equals("/rpc")) {code=405; throw new IllegalArgumentException("POST /rpc required");}
                    byte[] body = ex.getRequestBody().readNBytes(65537);
                    if (body.length > 65536) {code=413; throw new IllegalArgumentException("Request too large");}
                    if (JOBS.size() >= MAX_PENDING) {code=429; throw new IllegalStateException("Queue full");}
                    JsonObject request = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
                    CompletableFuture<JsonObject> future = new CompletableFuture<>();
                    Job job = new Job(request, future, System.nanoTime()+TimeUnit.SECONDS.toNanos(15));
                    JOBS.add(job);
                    try { result = future.get(16, TimeUnit.SECONDS); }
                    catch (TimeoutException e) {future.cancel(false); code=504; throw new IllegalStateException("Game thread/capture timeout; query status before retrying a mutation");}
                } catch (Exception e) {
                    if(code==200) code=400;
                    Throwable cause = e instanceof ExecutionException ? e.getCause() : e;
                    result = obj("ok", false, "error", String.valueOf(cause.getMessage()));
                }
                byte[] bytes = JSON.toJson(result).getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                ex.getResponseHeaders().set("Cache-Control", "no-store");
                ex.sendResponseHeaders(code, bytes.length);
                try (var output=ex.getResponseBody()) {output.write(bytes);}
                ex.close();
            });
            http.start();
            enabled = true;
            Runtime.getRuntime().addShutdownHook(new Thread(Bridge::close));
            System.out.println("[Minecraft Dev Bridge] loopback endpoint ready on " + port);
        } catch (Exception e) {throw new IllegalStateException("Cannot start Minecraft Dev Bridge", e);}
    }

    public static void close() {
        enabled=false;
        FrameCapture.close();
        if(server!=null)server.stop(0);
        if(workers!=null)workers.shutdownNow();
    }

    public static void tick() {
        if (!enabled) return;
        tick++;
        Minecraft mc = Minecraft.getInstance();
        mc.options.pauseOnLostFocus = false;
        if (System.nanoTime() >= inputUntil || mc.player == null || mc.gui.screen()!=null) release(mc);
        for (int i=0; i<16; i++) {
            Job job=JOBS.poll(); if(job==null)break;
            if(expired(job))continue;
            try {
                String op = string(job.request, "op");
                if(op.equals("screenshot")) FrameCapture.start(job.request,job.result);
                else job.result.complete(execute(mc, op, job.request));
            } catch (Throwable e) {job.result.completeExceptionally(e);}
        }
        if(mc.player!=null) {
            mc.player.input=INPUT;
            mc.options.keyUse.setDown(use);
            if(attack) ((ActionAccess)mc).bridgeContinueAttack(true);
        }
    }

    public static void frame() {
        if(!enabled) return;
        frame++;
        FrameCapture.frame(frame,tick);
    }

    private static boolean expired(Job job) {
        if(job.result.isDone()) return true;
        if(System.nanoTime()>job.deadline) {job.result.completeExceptionally(new TimeoutException("Queued action expired without execution")); return true;}
        return false;
    }

    private static JsonObject execute(Minecraft mc, String op, JsonObject r) throws Exception {
        if(op.equals("status")) return status(mc);
        if(op.equals("capture_start"))return FrameCapture.start(r,null);
        if(op.equals("capture_status"))return FrameCapture.status(string(r,"id"));
        if(op.equals("capture_stop"))return FrameCapture.stop(string(r,"id"));
        if(op.equals("stop")) {release(mc);return obj("ok",true,"tick",tick);}
        if(op.equals("quit")) {release(mc);mc.stop();return obj("ok",true);}
        if(op.equals("ui_click")) {
            Screen screen=mc.gui.screen();
            if(screen==null || !screen.getClass().getName().equals(string(r,"screen"))) throw new IllegalStateException("Screen changed; inspect status first");
            int i=integer(r,"index",0,screen.children().size()-1);
            if(!(screen.children().get(i) instanceof AbstractWidget w) || !w.active || !w.visible)throw new IllegalArgumentException("Not an active widget");
            MouseButtonEvent ev=new MouseButtonEvent(w.getX()+w.getWidth()/2.0,w.getY()+w.getHeight()/2.0,new MouseButtonInfo(1,0));
            boolean clicked=w.mouseClicked(ev,false);w.mouseReleased(ev);
            if(!clicked)throw new IllegalStateException("Widget did not accept click");
            return obj("ok",true,"clicked",true);
        }
        if(op.equals("reload_resources")) {mc.reloadResourcePacks();return obj("ok",true,"scheduled",true);}
        if(mc.player==null || mc.gameMode==null)throw new IllegalStateException("Client is not in a world");
        var p=mc.player;
        switch(op) {
            case "command" -> {
                String cmd=string(r,"command");
                if(cmd.startsWith("/"))cmd=cmd.substring(1);
                if(cmd.isBlank()||cmd.length()>2048||cmd.contains("\n")||cmd.contains("\r"))throw new IllegalArgumentException("Invalid command");
                p.connection.sendCommand(cmd);
            }
            case "look" -> {p.setYRot((float)number(r,"yaw",-36000,36000));p.setXRot((float)number(r,"pitch",-90,90));}
            case "camera" -> {mc.options.setCameraType(CameraType.valueOf(string(r,"mode")));}
            case "hotbar" -> p.getInventory().setSelectedSlot(integer(r,"slot",0,8));
            case "input" -> {
                if(mc.gui.screen()!=null)throw new IllegalStateException("Close the current screen before moving");
                int duration=integer(r,"durationMs",1,10000);
                Set<String> keys=new HashSet<>();
                for(JsonElement e:r.getAsJsonArray("keys")) {
                    String k=e.getAsString();
                    if(!Set.of("forward","back","left","right","jump","sneak","sprint","use","attack").contains(k))throw new IllegalArgumentException("Unknown input: "+k);
                    keys.add(k);
                }
                release(mc);
                forward=keys.contains("forward");back=keys.contains("back");left=keys.contains("left");right=keys.contains("right");
                jump=keys.contains("jump");sneak=keys.contains("sneak");sprint=keys.contains("sprint");use=keys.contains("use");attack=keys.contains("attack");
                inputUntil=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(duration);
                mc.options.keyUse.setDown(use);
                if(use)((ActionAccess)mc).bridgeUse();
                if(attack)((ActionAccess)mc).bridgeAttack();
            }
            case "attack" -> ((ActionAccess)mc).bridgeAttack();
            case "use" -> ((ActionAccess)mc).bridgeUse();
            case "inventory" -> {release(mc);mc.gui.setScreen(new InventoryScreen(p));}
            case "close_screen" -> {release(mc);p.closeContainer();mc.gui.setScreen(null);}
            case "click_slot" -> {
                int id=integer(r,"containerId",0,Integer.MAX_VALUE);
                if(p.containerMenu.containerId!=id)throw new IllegalStateException("Container changed; inspect status first");
                int slot=integer(r,"slot",0,p.containerMenu.slots.size()-1);
                int button=integer(r,"button",0,1);
                String mode=string(r,"mode");
                if(!Set.of("PICKUP","QUICK_MOVE").contains(mode))throw new IllegalArgumentException("Unsupported slot mode");
                mc.gameMode.handleContainerInput(id,slot,button,ContainerInput.valueOf(mode),p);
            }
            default -> throw new IllegalArgumentException("Unknown operation: "+op);
        }
        return obj("ok",true,"tick",tick);
    }

    private static JsonObject status(Minecraft mc) {
        long flags=SDLVideo.SDL_GetWindowFlags(mc.getWindow().handle());
        JsonObject s=obj("ok",true,"version","26.3","tick",tick,"frame",frame,"fps",mc.getFps(),"dedicated",true,"focused",(flags&SDLVideo.SDL_WINDOW_INPUT_FOCUS)!=0,"hidden",(flags&SDLVideo.SDL_WINDOW_HIDDEN)!=0,"mouseGrabbed",mc.mouseHandler.isMouseGrabbed(),"connected",mc.player!=null,"inputRemainingMs",Math.max(0,(inputUntil-System.nanoTime())/1000000),"timestamp",Instant.now().toString());
        Screen screen=mc.gui.screen();
        s.addProperty("screen",screen==null?null:screen.getClass().getName());
        JsonArray widgets=new JsonArray();
        if(screen!=null) {
            s.addProperty("screenTitle",screen.getTitle().getString());
            for(int i=0;i<screen.children().size();i++)if(screen.children().get(i) instanceof AbstractWidget w)
                widgets.add(obj("index",i,"text",w.getMessage().getString(),"active",w.active,"visible",w.visible));
        }
        s.add("widgets",widgets);
        if(mc.player!=null) {
            var p=mc.player;
            s.add("player",obj("name",p.getName().getString(),"x",p.getX(),"y",p.getY(),"z",p.getZ(),"yaw",p.getYRot(),"pitch",p.getXRot(),"health",p.getHealth(),"onGround",p.onGround(),"usingItem",p.isUsingItem(),"sprinting",p.isSprinting(),"sneaking",p.isShiftKeyDown(),"hotbar",p.getInventory().getSelectedSlot(),"camera",mc.options.getCameraType().name()));
            s.addProperty("containerId",p.containerMenu.containerId);
            JsonArray slots=new JsonArray();
            for(int i=0;i<p.containerMenu.slots.size();i++) {
                var item=p.containerMenu.slots.get(i).getItem();
                slots.add(obj("slot",i,"item",BuiltInRegistries.ITEM.getKey(item.getItem()).toString(),"count",item.getCount(),"name",item.getHoverName().getString()));
            }
            s.add("slots",slots);
        }
        s.add("resourcePacks",JSON.toJsonTree(mc.getResourcePackRepository().getSelectedIds()));
        s.add("capture",FrameCapture.activeStatus());
        s.add("render",obj("width",mc.gameRenderer.mainRenderTarget().width,"height",mc.gameRenderer.mainRenderTarget().height,"fpsLimit",mc.options.framerateLimit().get()));
        return s;
    }

    private static void release(Minecraft mc) {
        forward=back=left=right=jump=sneak=sprint=use=attack=false;
        inputUntil=0;
        mc.options.keyUse.setDown(false);
        if(mc.player!=null && mc.gameMode!=null) {
            if(mc.player.isUsingItem())mc.gameMode.releaseUsingItem(mc.player);
            mc.gameMode.stopDestroyBlock();
            mc.player.setSprinting(false);
        }
    }
    private static class RemoteInput extends ClientInput {
        @Override public void tick() {
            keyPresses=new Input(forward,back,left,right,jump,sneak,sprint);
            float x=(left?1:0)-(right?1:0), z=(forward?1:0)-(back?1:0);
            moveVector=new Vec2(x,z).normalized();
        }
    }
    private static String string(JsonObject r,String key) {return r.get(key).getAsString();}
    private static double number(JsonObject r,String key,double min,double max) {
        double v=r.get(key).getAsDouble();
        if(!Double.isFinite(v)||v<min||v>max)throw new IllegalArgumentException("Out of range: "+key);
        return v;
    }
    private static int integer(JsonObject r,String key,int min,int max) {
        double v=number(r,key,min,max);if(v!=Math.rint(v))throw new IllegalArgumentException("Integer required: "+key);return (int)v;
    }
    private static JsonObject obj(Object...pairs) {
        JsonObject o=new JsonObject();for(int i=0;i<pairs.length;i+=2)o.add(pairs[i].toString(),JSON.toJsonTree(pairs[i+1]));return o;
    }
}
