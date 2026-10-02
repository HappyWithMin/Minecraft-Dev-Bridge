package local.mcbridge.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Minecraft.class)
public interface ActionAccess {
    @Invoker("startAttack") boolean bridgeAttack();
    @Invoker("startUseItem") void bridgeUse();
    @Invoker("continueAttack") void bridgeContinueAttack(boolean active);
}
