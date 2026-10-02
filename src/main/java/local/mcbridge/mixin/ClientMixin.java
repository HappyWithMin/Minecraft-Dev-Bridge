package local.mcbridge.mixin;

import local.mcbridge.Bridge;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
abstract class ClientMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void bridgeTick(CallbackInfo ci) { Bridge.tick(); }
    @Inject(method = "renderFrame", at = @At("RETURN"))
    private void bridgeFrame(boolean tick, CallbackInfo ci) { Bridge.frame(); }
    @Inject(method = "close", at = @At("HEAD"))
    private void bridgeClose(CallbackInfo ci) { Bridge.close(); }
}
