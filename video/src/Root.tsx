import { Composition } from "remotion";

import { Pitch, totalFrames } from "./Pitch";
import { FPS } from "./script";

export const RemotionRoot: React.FC = () => (
  <Composition id="Pitch" component={Pitch} durationInFrames={totalFrames()} fps={FPS} width={1920} height={1080} />
);
