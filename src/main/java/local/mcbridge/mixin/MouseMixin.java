package local.mcbridge.mixin;

import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
abstract class MouseMixin {
    @Inject(method = "grabMouse", at = @At("HEAD"), cancellable = true)
    private void bridgeNoGrab(CallbackInfo ci) {
        if (Boolean.getBoolean("mcbridge.dedicated")) ci.cancel();
    }
}
