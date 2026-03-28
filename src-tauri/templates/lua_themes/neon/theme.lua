-- Neon Theme
-- Bright neon colors with cyan → magenta → yellow gradient

colors = {
    idle = {0, 255, 255},          -- #00ffff cyan
    recording = {255, 0, 255},     -- #ff00ff magenta
    transcribing = {0, 255, 0},    -- #00ff00 green
    queued = {255, 105, 0}         -- #ff6900 orange
}

gradient = {
    bottom = {0, 255, 255},        -- Cyan
    middle = {255, 0, 255},        -- Magenta
    top = {255, 255, 0}            -- Yellow
}

function lerp(a, b, t)
    return a + (b - a) * t
end

function lerp_color(c1, c2, t)
    return {
        lerp(c1[1], c2[1], t),
        lerp(c1[2], c2[2], t),
        lerp(c1[3], c2[3], t)
    }
end

function gradient_color(t)
    t = math.max(0, math.min(1, t))
    if t < 0.5 then
        return lerp_color(gradient.bottom, gradient.middle, t * 2)
    else
        return lerp_color(gradient.middle, gradient.top, (t - 0.5) * 2)
    end
end

function render(ctx, state, data)
    local w, h = ctx:size()
    local center_y = h / 2
    local max_h = h * 0.8

    if state == "idle" then
        ctx:set_color(colors.idle)
        ctx:draw_line(10, center_y, w - 10, center_y, 2)

    elseif state == "recording" then
        -- Gradient bars like winamp but with neon colors
        local bar_count = 32
        local bar_width = 4
        local gap = 2
        local total = bar_count * (bar_width + gap) - gap
        local start_x = (w - total) / 2

        for i = 1, bar_count do
            local level = data.levels[i] or 0
            local amp = math.min(1, math.sqrt(level * 8))
            local bar_h = math.max(2, amp * max_h)

            local x = start_x + (i - 1) * (bar_width + gap)

            -- Draw gradient bar segment by segment
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local color = gradient_color(t)

                ctx:set_color(color)
                ctx:draw_rect(x, y, bar_width, seg_h)
            end
        end

    elseif state == "transcribing" then
        -- Knight Rider scanner: 32 bars with gradient, brightness modulated by position
        local bar_count = 32
        local bar_width = 4
        local gap = 2
        local total = bar_count * (bar_width + gap) - gap
        local start_x = (w - total) / 2

        -- Ping-pong position (0 to bar_count-1 and back)
        local pos = math.abs(((data.time * 3) % 2) - 1) * (bar_count - 1)

        for i = 1, bar_count do
            local dist = math.abs((i - 1) - pos)
            local brightness = math.max(0, 1 - dist * 0.12)
            local bar_h = math.max(2, brightness * max_h * 0.7)

            local x = start_x + (i - 1) * (bar_width + gap)
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local color = gradient_color(t)
                -- Modulate by scanner brightness
                ctx:set_color({
                    math.floor(color[1] * brightness),
                    math.floor(color[2] * brightness),
                    math.floor(color[3] * brightness)
                })
                ctx:draw_rect(x, y, bar_width, seg_h)
            end
        end
    end
end
