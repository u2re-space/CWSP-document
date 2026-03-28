import { serviceChannels, type ServiceChannelId } from "@rs-com/core/ServiceChannels";
import { channelManager } from "@rs-com/core/UniformChannelManager";

let initialized = false;

const pickEnvironmentChannels = (): ServiceChannelId[] => {
    return ["home", "settings", "explorer"];
};

export const initializeEnvironmentChannels = async () => {
    if (initialized) return;
    initialized = true;

    const channels = pickEnvironmentChannels();
    for (const channelId of channels) {
        try {
            await serviceChannels.initChannel(channelId);
        } catch (error) {
            console.warn("[Environment] Failed to init channel:", channelId, error);
        }
    }

    try {
        await channelManager.initializeViewChannels("#home");
    } catch (error) {
        console.warn("[Environment] Uniform channel bootstrap failed:", error);
    }
};
