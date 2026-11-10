package local.mcbridge.mixin;

import com.mojang.blaze3d.Blaze3D;
import local.mcbridge.Bridge;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
abstract class MouseMixin {
    @Shadow private double accumulatedDX;
    @Shadow private double accumulatedDY;
    @Shadow private double lastHandleMovementTime;
    @Shadow protected abstract void turnPlayer(double mouseDeltaTime);

    @Inject(method = "grabMouse", at = @At("HEAD"), cancellable = true)
    private void bridgeNoGrab(CallbackInfo ci) {
        if (Boolean.getBoolean("mcbridge.dedicated")) ci.cancel();
    }

    /** The hidden window never has a grabbed mouse, so vanilla would discard movement; run its turn code directly. */
    @Inject(method = "handleAccumulatedMovement", at = @At("HEAD"))
    private void bridgeTurn(CallbackInfo ci) {
        double[] counts = Bridge.mouseCounts();
        if (counts == null) return;
        accumulatedDX = counts[0];
        accumulatedDY = counts[1];
        turnPlayer(Blaze3D.getTime() - lastHandleMovementTime);
        accumulatedDX = accumulatedDY = 0;
    }
}
